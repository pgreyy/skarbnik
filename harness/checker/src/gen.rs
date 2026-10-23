//! Seeded input generators for the checker. Given the same seed they always produce the same
//! inputs, on any machine, so a verdict can be re-checked by anyone who knows the seed.
//!
//! Two generators live here:
//! - `fairness_inputs`: fresh inputs in the demo parser's record format (mostly well formed,
//!   some deliberately broken). The candidate must agree with the original program on each.
//! - `exploit_variants`: copies of the secret crash input with one or two bytes changed. The
//!   candidate must not crash on a variant that still crashes the original, so a patch that only
//!   recognises the exact secret bytes fails.
//!
//! The fairness generator knows the demo parser's input format (tag, length, payload records).
//! A different program would need its own generator; that is a known limit of this spike.

/// Separates the random streams of the two generators, so they never reuse the same numbers.
pub const FAIRNESS_DOMAIN: u64 = 0x6b69_6e74_7375_6731; // "kintsug1"
pub const VARIANT_DOMAIN: u64 = 0x6b69_6e74_7375_6732; // "kintsug2"

/// A small deterministic random number generator (SplitMix64). Not for cryptography; it only has
/// to be the same everywhere and well spread.
pub struct Rng {
    state: u64,
}

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

impl Rng {
    /// Builds a generator from a 32 byte seed and a domain constant.
    pub fn from_seed(seed: &[u8; 32], domain: u64) -> Rng {
        let mut state = domain;
        for chunk in seed.chunks(8) {
            let mut word = [0u8; 8];
            word.copy_from_slice(chunk);
            state ^= u64::from_le_bytes(word);
            splitmix64(&mut state);
        }
        Rng { state }
    }

    pub fn next_u64(&mut self) -> u64 {
        splitmix64(&mut self.state)
    }

    /// A number in 0..n (n must be above 0). The tiny bias of `%` does not matter here.
    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }

    pub fn byte(&mut self) -> u8 {
        self.next_u64() as u8
    }
}

/// One record in the demo format: tag, length, payload.
fn gen_record(rng: &mut Rng) -> Vec<u8> {
    let mut rec = Vec::new();
    match rng.below(16) {
        // Unknown tag (the parser answers -2).
        0 => {
            let tag = 4 + rng.below(252) as u8;
            let len = rng.below(4) as u8;
            rec.push(tag);
            rec.push(len);
            for _ in 0..len {
                rec.push(rng.byte());
            }
        }
        // Int: 1 to 4 bytes.
        1..=5 => {
            let len = 1 + rng.below(4) as u8;
            rec.push(1);
            rec.push(len);
            for _ in 0..len {
                rec.push(rng.byte());
            }
        }
        // Text: 0 to 12 bytes.
        6..=10 => {
            let len = rng.below(13) as u8;
            rec.push(2);
            rec.push(len);
            for _ in 0..len {
                rec.push(rng.byte());
            }
        }
        // List: n items of two bytes, sometimes with one or two extra trailing bytes,
        // which the original program accepts and ignores.
        _ => {
            let n = rng.below(6) as u8;
            let extra = if rng.below(4) == 0 { 1 + rng.below(2) as u8 } else { 0 };
            let len = 1 + 2 * n + extra;
            rec.push(3);
            rec.push(len);
            rec.push(n);
            for _ in 0..(len - 1) {
                rec.push(rng.byte());
            }
        }
    }
    rec
}

/// One fresh input: 1 to 6 records, and in 1 of 8 inputs one deliberate defect
/// (cut short, or one byte overwritten), so error answers are compared too.
fn gen_input(rng: &mut Rng, max_len: usize) -> Vec<u8> {
    let mut out = Vec::new();
    let records = 1 + rng.below(6);
    for _ in 0..records {
        let rec = gen_record(rng);
        if out.len() + rec.len() > max_len {
            break;
        }
        out.extend_from_slice(&rec);
    }
    if !out.is_empty() && rng.below(8) == 0 {
        if rng.below(2) == 0 {
            let cut = rng.below(out.len() as u64) as usize;
            out.truncate(cut);
        } else {
            let at = rng.below(out.len() as u64) as usize;
            out[at] = rng.byte();
        }
    }
    out
}

/// `count` fresh inputs for the fairness check, each at most `max_len` bytes.
pub fn fairness_inputs(seed: &[u8; 32], count: u32, max_len: usize) -> Vec<Vec<u8>> {
    let mut rng = Rng::from_seed(seed, FAIRNESS_DOMAIN);
    (0..count).map(|_| gen_input(&mut rng, max_len)).collect()
}

/// `count` copies of the secret crash input, each with one or two bytes set to random values.
pub fn exploit_variants(exploit: &[u8], seed: &[u8; 32], count: u32) -> Vec<Vec<u8>> {
    if exploit.is_empty() {
        return Vec::new();
    }
    let mut rng = Rng::from_seed(seed, VARIANT_DOMAIN);
    (0..count)
        .map(|_| {
            let mut v = exploit.to_vec();
            let changes = 1 + rng.below(2);
            for _ in 0..changes {
                let at = rng.below(v.len() as u64) as usize;
                v[at] = rng.byte();
            }
            v
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_inputs() {
        let seed = [7u8; 32];
        assert_eq!(fairness_inputs(&seed, 50, 256), fairness_inputs(&seed, 50, 256));
        let mut other = seed;
        other[31] ^= 1;
        assert_ne!(fairness_inputs(&seed, 50, 256), fairness_inputs(&other, 50, 256));
    }

    #[test]
    fn inputs_respect_max_len() {
        for input in fairness_inputs(&[3u8; 32], 500, 32) {
            assert!(input.len() <= 32);
        }
    }

    #[test]
    fn variants_keep_length_and_differ_by_at_most_two_bytes() {
        let exploit = [1u8, 2, 3, 4, 5, 6, 7, 8];
        for v in exploit_variants(&exploit, &[9u8; 32], 100) {
            assert_eq!(v.len(), exploit.len());
            let diff = v.iter().zip(exploit.iter()).filter(|(a, b)| a != b).count();
            assert!(diff <= 2);
        }
    }
}
