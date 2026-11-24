//! Random external calls through nearcore's near-primitives: their encoding,
//! call hash and unique ids, and nearcore's verdict on mutated encodings.

use borsh::BorshDeserialize;
use near_primitives::hash::hash;
use near_primitives::transaction::{EccTransaction, TransactionEnvelope};
use near_primitives::types::AccountId;
use near_primitives::universal_state_init::RawStateInit;
use near_primitives::utils::create_ecc_outcome_id;
use serde_json::{Value, json};

const CALLS: usize = 500;
const MUTATIONS: usize = 3000;

/// xorshift64*, so every run writes the same file.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| self.next() as u8).collect()
    }
    /// A length skewed toward the edges: 0, 1, small, and up to `max`.
    fn len(&mut self, max: u64) -> usize {
        match self.below(6) {
            0 => 0,
            1 => 1,
            2 => self.below(8) as usize,
            _ => self.below(max + 1) as usize,
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn account_id(rng: &mut Rng) -> AccountId {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789-_.";
    loop {
        let candidate: String = match rng.below(5) {
            0 => hex(&rng.bytes(32)),
            1 => format!("0x{}", hex(&rng.bytes(20))),
            _ => {
                let len = 2 + rng.below(63) as usize;
                (0..len)
                    .map(|_| CHARS[rng.below(CHARS.len() as u64) as usize] as char)
                    .collect()
            }
        };
        if let Ok(id) = candidate.parse() {
            return id;
        }
    }
}

fn height(rng: &mut Rng) -> u64 {
    match rng.below(5) {
        0 => rng.below(1000),
        1 => u64::MAX - rng.below(1000),
        2 => (1 << 32) + rng.below(1000) - 500,
        3 => rng.below(1 << 53),
        _ => rng.next(),
    }
}

fn decoded(bytes: &[u8]) -> Value {
    match TransactionEnvelope::try_from_slice(bytes) {
        Ok(TransactionEnvelope::Unsigned(ecc)) => json!({
            "ok": true,
            "contract_id": ecc.contract_id().as_str(),
            "payload": hex(ecc.payload()),
            "state_init": ecc.state_init().map(|s| hex(&s.0)),
        }),
        Ok(_) => json!({ "ok": false, "signed": true }),
        Err(_) => json!({ "ok": false }),
    }
}

fn mutate(rng: &mut Rng, bytes: &[u8]) -> Vec<u8> {
    let mut out = bytes.to_vec();
    match rng.below(9) {
        // Flip one byte after the escape byte.
        0 | 1 if out.len() > 1 => {
            let i = 1 + rng.below(out.len() as u64 - 1) as usize;
            out[i] ^= 1 << rng.below(8);
        }
        // Truncate.
        2 => out.truncate(rng.below(out.len() as u64) as usize),
        // Trailing bytes.
        3 => {
            let len = 1 + rng.below(4) as usize;
            out.extend(rng.bytes(len));
        }
        // Another version.
        4 => out[1] = 1 + rng.below(255) as u8,
        // A length prefix off by a little.
        5 if out.len() >= 6 => {
            let delta = rng.below(5) as u32;
            let len = u32::from_le_bytes(out[2..6].try_into().unwrap());
            let len = if rng.below(2) == 0 { len.wrapping_add(delta) } else { len.wrapping_sub(delta) };
            out[2..6].copy_from_slice(&len.to_le_bytes());
        }
        // A byte of the contract id set to an arbitrary value.
        6 if out.len() > 6 => {
            let len = u32::from_le_bytes(out[2..6].try_into().unwrap()) as usize;
            if len > 0 && out.len() >= 6 + len {
                let i = 6 + rng.below(len as u64) as usize;
                out[i] = rng.next() as u8;
            }
        }
        // The option tag.
        7 => {
            let last = out.len() - 1;
            out[last] = rng.next() as u8;
        }
        // Arbitrary bytes after the prefix.
        _ => {
            let len = rng.below(40) as usize;
            out = [vec![0xFF, 0x00], rng.bytes(len)].concat();
        }
    }
    out
}

fn main() {
    let mut rng = Rng(0x6E65_6172_6B69_7421);
    let mut calls = Vec::new();
    let mut encodings = Vec::new();
    for _ in 0..CALLS {
        let contract_id = account_id(&mut rng);
        let payload_len = rng.len(600);
        let payload = rng.bytes(payload_len);
        let state_init = if rng.below(3) == 0 {
            let len = rng.len(200);
            Some(RawStateInit(rng.bytes(len)))
        } else {
            None
        };
        let ecc = EccTransaction::new_with_state_init(contract_id.clone(), payload.clone(), state_init.clone());
        let call_hash = *ecc.hash_without_state_init();
        let bytes = borsh::to_vec(&TransactionEnvelope::from(ecc)).unwrap();
        let heights: Vec<u64> = (0..3).map(|_| height(&mut rng)).collect();
        calls.push(json!({
            "contract_id": contract_id.as_str(),
            "payload": hex(&payload),
            "state_init": state_init.as_ref().map(|s| hex(&s.0)),
            "bytes": hex(&bytes),
            "call_hash": call_hash.to_string(),
            "tx_root_leaf_hash": hash(&bytes).to_string(),
            "unique_ids": heights.iter().map(|h| json!({
                "height": h.to_string(),
                "unique_id": create_ecc_outcome_id(&call_hash, *h).to_string(),
            })).collect::<Vec<_>>(),
        }));
        encodings.push(bytes);
    }
    let mut decodes = Vec::new();
    for _ in 0..MUTATIONS {
        let source = &encodings[rng.below(encodings.len() as u64) as usize];
        let bytes = mutate(&mut rng, source);
        let mut entry = decoded(&bytes);
        entry["bytes"] = json!(hex(&bytes));
        decodes.push(entry);
    }
    let accepted = decodes.iter().filter(|d| d["ok"] == true).count();
    eprintln!("{} calls, {} decodes ({} accepted)", calls.len(), decodes.len(), accepted);
    let out = json!({
        "source": "near-primitives 0.39.0-rc.1 (nearcore 2.15.0-rc.1), tests/fixtures/nearcore-2.15/oracle",
        "calls": calls,
        "decodes": decodes,
    });
    println!("{}", serde_json::to_string(&out).unwrap());
}
