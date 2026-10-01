import * as Schema from "effect/Schema"

const Operation = Schema.Literals([
  "account",
  "block",
  "status",
  "view",
  "viewBytes",
  "accessKey",
  "accessKeys",
  "gasKeyNonces",
  "code",
  "globalCode",
  "statePage",
  "statePages",
  "gasPrice",
  "genesisSummary",
  "maintenanceWindows",
  "blockEffects",
])
export type Operation = typeof Operation.Type

export class RequestError extends Schema.TaggedError<RequestError>()(
  "RequestError",
  {
    operation: Operation,
    reason: Schema.Literals([
      "Configuration",
      "AccountId",
      "PublicKey",
      "Hash",
      "Method",
      "BlockSelector",
      "Arguments",
      "ResultSchema",
      "Pagination",
    ]),
  },
) {
  override get message() {
    return `Invalid ${this.operation} request: ${this.reason}`
  }
}
export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  {
    operation: Operation,
    phase: Schema.Literals(["Request", "Body"]),
  },
) {
  override get message() {
    return `${this.operation} transport failed during ${this.phase}`
  }
}
export class HttpError extends Schema.TaggedError<HttpError>()("HttpError", {
  operation: Operation,
  status: Schema.Int,
}) {
  override get message() {
    return `${this.operation} HTTP status ${this.status}`
  }
}
export class DecodeError extends Schema.TaggedError<DecodeError>()(
  "DecodeError",
  {
    operation: Operation,
    reason: Schema.Literals([
      "BodyTooLarge",
      "InvalidUtf8",
      "InvalidJson",
      "JsonResource",
      "InvalidEnvelope",
      "MismatchedId",
      "InvalidResponse",
      "BlockMismatch",
      "IdentifierMismatch",
      "ResultSchema",
      "Pagination",
    ]),
  },
) {
  override get message() {
    return `Invalid ${this.operation} response: ${this.reason}`
  }
}
export class RpcError extends Schema.TaggedError<RpcError>()("RpcError", {
  operation: Operation,
  code: Schema.optionalKey(Schema.Int),
  kind: Schema.Literals([
    "Unknown",
    "ContractExecution",
    "CodeUnavailable",
    "GlobalCodeUnavailable",
    "UnknownBlock",
    "PrunedBlock",
    "NodeNotSynced",
    "ShardUnavailable",
    "StateTooLarge",
    "MethodNotFound",
    "GasKeyUnavailable",
  ]),
}) {
  override get message() {
    return `${this.operation} RPC rejection: ${this.kind}${this.code === undefined ? "" : ` (${this.code})`}`
  }
}
export class UnsupportedError extends Schema.TaggedError<UnsupportedError>()(
  "UnsupportedError",
  {
    operation: Operation,
    feature: Schema.Literals(["LosslessJson", "AccessKeyPagination"]),
  },
) {
  override get message() {
    return `${this.operation} requires unsupported ${this.feature} capability`
  }
}
export class AccountNotFound extends Schema.TaggedError<AccountNotFound>()(
  "AccountNotFound",
  {
    operation: Operation,
    accountId: Schema.String,
  },
) {
  override get message() {
    return "The requested account was not found"
  }
}
export class AccessKeyNotFound extends Schema.TaggedError<AccessKeyNotFound>()(
  "AccessKeyNotFound",
  {
    operation: Operation,
    accountId: Schema.String,
    publicKey: Schema.String,
  },
) {
  override get message() {
    return "The requested access key was not found; this does not establish account existence"
  }
}
export type ReadError =
  | RequestError
  | TransportError
  | HttpError
  | DecodeError
  | RpcError
  | UnsupportedError
  | AccountNotFound
  | AccessKeyNotFound
