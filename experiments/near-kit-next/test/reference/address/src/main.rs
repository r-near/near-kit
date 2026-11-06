//! Public-data reference only: the enum/struct definitions match nearcore 2.13.4
//! 44f7ae6 core/primitives-core/{deterministic_account_id,global_contract}.rs.
//! No nearcore, signing, account creation or transaction dependencies.
use borsh::BorshSerialize;
use sha3::{Digest, Keccak256};
use std::collections::BTreeMap;

#[derive(BorshSerialize)]
enum StateInit { V1(StateInitV1) }
#[derive(BorshSerialize)]
struct StateInitV1 { code: GlobalContractIdentifier, data: BTreeMap<Vec<u8>, Vec<u8>> }
#[derive(BorshSerialize)]
enum GlobalContractIdentifier { CodeHash([u8; 32]), AccountId(String) }

fn unhex(input: &str) -> Vec<u8> {
    assert_eq!(input.len() % 2, 0);
    input.as_bytes().chunks_exact(2).map(|pair| {
        u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap()
    }).collect()
}
fn hex(input: &[u8]) -> String { input.iter().map(|byte| format!("{byte:02x}")).collect() }

fn main() {
    let fixtures: serde_json::Value = serde_json::from_str(include_str!("../../../fixtures/address.json")).unwrap();
    let mut results = Vec::new();
    for row in fixtures.as_array().unwrap() {
        let code = match row["code"]["accountId"].as_str() {
            Some(account) => GlobalContractIdentifier::AccountId(account.to_owned()),
            None => GlobalContractIdentifier::CodeHash(unhex(row["codeBytes"].as_str().unwrap()).try_into().unwrap()),
        };
        let data: BTreeMap<Vec<u8>, Vec<u8>> = row["data"].as_array().unwrap().iter().map(|entry| {
            (unhex(entry[0].as_str().unwrap()), unhex(entry[1].as_str().unwrap()))
        }).collect();
        let bytes = borsh::to_vec(&StateInit::V1(StateInitV1 { code, data })).unwrap();
        let digest = Keccak256::digest(&bytes);
        let address = format!("0s{}", hex(&digest[12..32]));
        assert_eq!(hex(&bytes), row["encoded"].as_str().unwrap());
        assert_eq!(address, row["address"].as_str().unwrap());
        results.push(serde_json::json!({"name": row["name"], "encoded": hex(&bytes), "address": address}));
    }
    println!("{}", serde_json::json!({"reference": "borsh 1.5.3 / sha3 0.10.6", "passed": true, "vectors": results}));
}
