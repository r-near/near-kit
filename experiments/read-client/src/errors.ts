import { Schema } from "effect"

const Operation = Schema.Literals(["account", "block", "status", "view", "viewBytes"])
export type Operation = typeof Operation.Type

export class RequestError extends Schema.TaggedError<RequestError>()("RequestError", {
  operation: Operation,
  reason: Schema.Literals([
    "Configuration", "AccountId", "Method", "BlockSelector", "Arguments", "ResultSchema",
  ]),
}) {
  override get message() { return `Invalid ${this.operation} request: ${this.reason}` }
}

export class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  operation: Operation,
  phase: Schema.Literals(["Request", "Body"]),
}) {
  override get message() { return `${this.operation} transport failed during ${this.phase}` }
}

export class HttpError extends Schema.TaggedError<HttpError>()("HttpError", {
  operation: Operation,
  status: Schema.Int,
}) {
  override get message() { return `${this.operation} HTTP status ${this.status}` }
}

export class DecodeError extends Schema.TaggedError<DecodeError>()("DecodeError", {
  operation: Operation,
  reason: Schema.Literals([
    "BodyTooLarge", "InvalidUtf8", "InvalidJson", "InvalidEnvelope", "MismatchedId",
    "InvalidResponse", "BlockMismatch", "AccountMismatch", "ResultSchema",
  ]),
}) {
  override get message() { return `Invalid ${this.operation} response: ${this.reason}` }
}

export class RpcError extends Schema.TaggedError<RpcError>()("RpcError", {
  operation: Operation,
  code: Schema.optionalKey(Schema.Int),
  kind: Schema.Literals(["Unknown", "ContractExecution"]),
}) {
  override get message() {
    return `${this.operation} RPC rejection: ${this.kind}${this.code === undefined ? "" : ` (${this.code})`}`
  }
}

export class AccountNotFound extends Schema.TaggedError<AccountNotFound>()("AccountNotFound", {
  operation: Schema.Literal("account"),
  accountId: Schema.String,
}) {
  override get message() { return "The requested account was not found" }
}

/** Expected failures only. Defects and interruption remain in the Effect cause. */
export type ReadError = RequestError | TransportError | HttpError | DecodeError | RpcError | AccountNotFound
