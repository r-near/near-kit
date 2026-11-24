;; A contract that accepts external calls (NEP-667).
;;
;; `__external_call` logs "checked", then decides on the payload's first byte:
;; - 0xFF: refuses the call (traps after logging).
;; - "p":  accepts it and transfers 1 yoctoNEAR to itself, so the call leads to
;;         a receipt.
;; - anything else: accepts it.
;; An accepted call returns its payload.
(module
  (import "env" "input" (func $input (param i64)))
  (import "env" "register_len" (func $register_len (param i64) (result i64)))
  (import "env" "read_register" (func $read_register (param i64 i64)))
  (import "env" "value_return" (func $value_return (param i64 i64)))
  (import "env" "log_utf8" (func $log_utf8 (param i64 i64)))
  (import "env" "current_account_id" (func $current_account_id (param i64)))
  (import "env" "promise_batch_create" (func $promise_batch_create (param i64 i64) (result i64)))
  (import "env" "promise_batch_action_transfer" (func $promise_batch_action_transfer (param i64 i64)))
  (memory (export "memory") 1)
  (data (i32.const 60000) "checked")
  (data (i32.const 60016) "\01\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00")
  (func (export "__external_call")
    (call $input (i64.const 0))
    (call $read_register (i64.const 0) (i64.const 0))
    (call $log_utf8 (i64.const 7) (i64.const 60000))
    (if (i32.eq (i32.load8_u (i32.const 0)) (i32.const 255)) (then unreachable))
    (if (i32.eq (i32.load8_u (i32.const 0)) (i32.const 112))
      (then
        (call $current_account_id (i64.const 1))
        (call $read_register (i64.const 1) (i64.const 40000))
        (call $promise_batch_action_transfer
          (call $promise_batch_create (call $register_len (i64.const 1)) (i64.const 40000))
          (i64.const 60016))))
    (call $value_return (call $register_len (i64.const 0)) (i64.const 0))
  )
)
