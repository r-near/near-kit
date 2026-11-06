(module
  (import "env" "value_return" (func $return (param i64 i64)))
  (import "env" "input" (func $input (param i64)))
  (import "env" "register_len" (func $length (param i64) (result i64)))
  (import "env" "read_register" (func $read (param i64 i64)))
  (import "env" "panic_utf8" (func $panic (param i64 i64)))
  (import "env" "log_utf8" (func $log (param i64 i64)))
  (memory (export "memory") 1)
  (data (i32.const 0) "{\22count\22:7}")
  (data (i32.const 32) "\00\ff\01")
  (data (i32.const 64) "notjson")
  (data (i32.const 80) "\ff")
  (data (i32.const 96) "fixture panic")
  (data (i32.const 200) "fixture log")
  (func (export "json")
    i64.const 11 i64.const 200 call $log
    i64.const 11 i64.const 0 call $return)
  (func (export "binary") i64.const 3 i64.const 32 call $return)
  (func (export "empty") i64.const 0 i64.const 0 call $return)
  (func (export "invalid_json") i64.const 7 i64.const 64 call $return)
  (func (export "invalid_utf8") i64.const 1 i64.const 80 call $return)
  (func (export "panic") i64.const 13 i64.const 96 call $panic)
  (func (export "echo")
    i64.const 0 call $input
    i64.const 0 i64.const 256 call $read
    i64.const 0 call $length
    i64.const 256 call $return))
