//! Turns the text formats used for test data into bytes and numbers: hex strings, 32 byte seeds
//! and the public test list. These are pure functions (text in, values out); reading the files is
//! left to the command line tool.
//!
//! Public test list format, one test per line: `<input as hex, or - for empty> <expected i32>`.
//! Text after `#` is a comment. Blank lines are ignored.

use crate::TestCase;

/// Parses hex such as "0a1B" into bytes. Spaces are allowed and ignored.
pub fn parse_hex(s: &str) -> Result<Vec<u8>, String> {
    let digits: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if digits.len() % 2 != 0 {
        return Err("hex has an odd number of digits".into());
    }
    let nibble = |c: u8| -> Result<u8, String> {
        match c {
            b'0'..=b'9' => Ok(c - b'0'),
            b'a'..=b'f' => Ok(c - b'a' + 10),
            b'A'..=b'F' => Ok(c - b'A' + 10),
            _ => Err(format!("not a hex digit: {:?}", c as char)),
        }
    };
    digits
        .chunks(2)
        .map(|pair| Ok(nibble(pair[0])? << 4 | nibble(pair[1])?))
        .collect()
}

/// Bytes to lower case hex.
pub fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 15) as usize] as char);
    }
    s
}

/// Parses a 32 byte seed written as 64 hex digits.
pub fn parse_seed(s: &str) -> Result<[u8; 32], String> {
    let bytes = parse_hex(s)?;
    bytes.try_into().map_err(|_| "a seed must be exactly 32 bytes (64 hex digits)".to_string())
}

/// Parses the public test list (format in the module comment).
pub fn parse_tests(text: &str) -> Result<Vec<TestCase>, String> {
    let mut tests = Vec::new();
    for (n, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let (Some(input), Some(expected), None) = (parts.next(), parts.next(), parts.next()) else {
            return Err(format!("line {}: expected `<hex or -> <number>`", n + 1));
        };
        let input = if input == "-" {
            Vec::new()
        } else {
            parse_hex(input).map_err(|e| format!("line {}: {e}", n + 1))?
        };
        let expected = expected
            .parse::<i32>()
            .map_err(|e| format!("line {}: bad expected value: {e}", n + 1))?;
        tests.push(TestCase { input, expected });
    }
    Ok(tests)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trip() {
        assert_eq!(parse_hex("00 ff 1A").unwrap(), vec![0, 255, 26]);
        assert_eq!(to_hex(&[0, 255, 26]), "00ff1a");
        assert!(parse_hex("abc").is_err());
        assert!(parse_hex("zz").is_err());
    }

    #[test]
    fn test_list() {
        let t = parse_tests("# comment\n- 5\n0102 -1 # trailing\n\n").unwrap();
        assert_eq!(t.len(), 2);
        assert_eq!(t[0], TestCase { input: vec![], expected: 5 });
        assert_eq!(t[1], TestCase { input: vec![1, 2], expected: -1 });
        assert!(parse_tests("01").is_err());
    }

    #[test]
    fn seed_length() {
        assert!(parse_seed(&"ab".repeat(32)).is_ok());
        assert!(parse_seed(&"ab".repeat(31)).is_err());
    }
}
