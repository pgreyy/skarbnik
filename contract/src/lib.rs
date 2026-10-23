//! Hello world NEAR contract for spike S0. It stores one greeting that anyone can read
//! and anyone can change. It holds no money and has no rules yet; the bounty logic comes later.

use near_sdk::{env, log, near};

#[near(contract_state)]
pub struct Contract {
    greeting: String,
}

impl Default for Contract {
    fn default() -> Self {
        Self {
            greeting: "hello from kintsugi".to_string(),
        }
    }
}

#[near]
impl Contract {
    /// Read the stored greeting. Free to call, changes nothing.
    pub fn get_greeting(&self) -> String {
        self.greeting.clone()
    }

    /// Replace the greeting and log who changed it and at which block.
    pub fn set_greeting(&mut self, greeting: String) {
        log!(
            "greeting set by {} at block {}",
            env::predecessor_account_id(),
            env::block_height()
        );
        self.greeting = greeting;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_then_set() {
        let mut contract = Contract::default();
        assert_eq!(contract.get_greeting(), "hello from kintsugi");
        contract.set_greeting("changed".to_string());
        assert_eq!(contract.get_greeting(), "changed");
    }
}
