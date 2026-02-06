export type Escrow = {
  "version": "0.1.0",
  "name": "escrow",
  "instructions": [
    {
      "name": "createEscrow",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "recipient",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "arbiter",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "feeRecipient",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "escrowId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "deadline",
          "type": "i64"
        },
        {
          "name": "termsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "feeBasisPoints",
          "type": "u16"
        }
      ]
    },
    {
      "name": "acceptTask",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "recipient",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "releasePayment",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "recipient",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "feeRecipient",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "requestRefund",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "dispute",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "disputer",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "reason",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "resolveDispute",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "arbiter",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "recipient",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "feeRecipient",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "winner",
          "type": {
            "defined": "DisputeWinner"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "escrowAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "docs": [
              "Creator (task poster) pubkey"
            ],
            "type": "publicKey"
          },
          {
            "name": "recipient",
            "docs": [
              "Recipient (task executor) pubkey"
            ],
            "type": "publicKey"
          },
          {
            "name": "amount",
            "docs": [
              "Amount in lamports held in escrow"
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "docs": [
              "Current status"
            ],
            "type": {
              "defined": "EscrowStatus"
            }
          },
          {
            "name": "deadline",
            "docs": [
              "Deadline as Unix timestamp (seconds)"
            ],
            "type": "i64"
          },
          {
            "name": "termsHash",
            "docs": [
              "SHA256 hash of terms/agreement"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "arbiter",
            "docs": [
              "Arbiter pubkey (for dispute resolution)"
            ],
            "type": "publicKey"
          },
          {
            "name": "feeBasisPoints",
            "docs": [
              "Fee in basis points (e.g. 150 = 1.5%)"
            ],
            "type": "u16"
          },
          {
            "name": "feeRecipient",
            "docs": [
              "Fee recipient (treasury) pubkey"
            ],
            "type": "publicKey"
          },
          {
            "name": "createdAt",
            "docs": [
              "Creation timestamp (Unix seconds)"
            ],
            "type": "i64"
          },
          {
            "name": "escrowId",
            "docs": [
              "Unique escrow ID"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "disputeReason",
            "docs": [
              "Dispute reason (truncated to 64 bytes)"
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "DisputeWinner",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Creator"
          },
          {
            "name": "Recipient"
          }
        ]
      }
    },
    {
      "name": "EscrowStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Created"
          },
          {
            "name": "Active"
          },
          {
            "name": "Completed"
          },
          {
            "name": "Disputed"
          },
          {
            "name": "Refunded"
          },
          {
            "name": "Cancelled"
          },
          {
            "name": "Resolved"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidStatus",
      "msg": "Escrow is not in the expected status for this operation"
    },
    {
      "code": 6001,
      "name": "UnauthorizedCreator",
      "msg": "Only the creator can perform this action"
    },
    {
      "code": 6002,
      "name": "UnauthorizedRecipient",
      "msg": "Only the recipient can perform this action"
    },
    {
      "code": 6003,
      "name": "UnauthorizedArbiter",
      "msg": "Only the arbiter can resolve disputes"
    },
    {
      "code": 6004,
      "name": "DeadlineNotReached",
      "msg": "Deadline has not passed yet"
    },
    {
      "code": 6005,
      "name": "DeadlineExpired",
      "msg": "Deadline has already passed"
    },
    {
      "code": 6006,
      "name": "FeeTooHigh",
      "msg": "Fee basis points exceeds maximum (1000 = 10%)"
    },
    {
      "code": 6007,
      "name": "ZeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6008,
      "name": "Overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6009,
      "name": "UnauthorizedDisputer",
      "msg": "Only creator or recipient can dispute"
    }
  ]
};

export const IDL: Escrow = {
  "version": "0.1.0",
  "name": "escrow",
  "instructions": [
    {
      "name": "createEscrow",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "recipient",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "arbiter",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "feeRecipient",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "escrowId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "deadline",
          "type": "i64"
        },
        {
          "name": "termsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "feeBasisPoints",
          "type": "u16"
        }
      ]
    },
    {
      "name": "acceptTask",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "recipient",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "releasePayment",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "recipient",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "feeRecipient",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "requestRefund",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "dispute",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "disputer",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "reason",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "resolveDispute",
      "accounts": [
        {
          "name": "escrowAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "arbiter",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "recipient",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "feeRecipient",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "winner",
          "type": {
            "defined": "DisputeWinner"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "escrowAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "docs": [
              "Creator (task poster) pubkey"
            ],
            "type": "publicKey"
          },
          {
            "name": "recipient",
            "docs": [
              "Recipient (task executor) pubkey"
            ],
            "type": "publicKey"
          },
          {
            "name": "amount",
            "docs": [
              "Amount in lamports held in escrow"
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "docs": [
              "Current status"
            ],
            "type": {
              "defined": "EscrowStatus"
            }
          },
          {
            "name": "deadline",
            "docs": [
              "Deadline as Unix timestamp (seconds)"
            ],
            "type": "i64"
          },
          {
            "name": "termsHash",
            "docs": [
              "SHA256 hash of terms/agreement"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "arbiter",
            "docs": [
              "Arbiter pubkey (for dispute resolution)"
            ],
            "type": "publicKey"
          },
          {
            "name": "feeBasisPoints",
            "docs": [
              "Fee in basis points (e.g. 150 = 1.5%)"
            ],
            "type": "u16"
          },
          {
            "name": "feeRecipient",
            "docs": [
              "Fee recipient (treasury) pubkey"
            ],
            "type": "publicKey"
          },
          {
            "name": "createdAt",
            "docs": [
              "Creation timestamp (Unix seconds)"
            ],
            "type": "i64"
          },
          {
            "name": "escrowId",
            "docs": [
              "Unique escrow ID"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "disputeReason",
            "docs": [
              "Dispute reason (truncated to 64 bytes)"
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "DisputeWinner",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Creator"
          },
          {
            "name": "Recipient"
          }
        ]
      }
    },
    {
      "name": "EscrowStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Created"
          },
          {
            "name": "Active"
          },
          {
            "name": "Completed"
          },
          {
            "name": "Disputed"
          },
          {
            "name": "Refunded"
          },
          {
            "name": "Cancelled"
          },
          {
            "name": "Resolved"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidStatus",
      "msg": "Escrow is not in the expected status for this operation"
    },
    {
      "code": 6001,
      "name": "UnauthorizedCreator",
      "msg": "Only the creator can perform this action"
    },
    {
      "code": 6002,
      "name": "UnauthorizedRecipient",
      "msg": "Only the recipient can perform this action"
    },
    {
      "code": 6003,
      "name": "UnauthorizedArbiter",
      "msg": "Only the arbiter can resolve disputes"
    },
    {
      "code": 6004,
      "name": "DeadlineNotReached",
      "msg": "Deadline has not passed yet"
    },
    {
      "code": 6005,
      "name": "DeadlineExpired",
      "msg": "Deadline has already passed"
    },
    {
      "code": 6006,
      "name": "FeeTooHigh",
      "msg": "Fee basis points exceeds maximum (1000 = 10%)"
    },
    {
      "code": 6007,
      "name": "ZeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6008,
      "name": "Overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6009,
      "name": "UnauthorizedDisputer",
      "msg": "Only creator or recipient can dispute"
    }
  ]
};
