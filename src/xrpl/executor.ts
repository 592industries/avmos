import {
  Client,
  Wallet,
  convertStringToHex,
  type Payment,
  type TrustSet,
  type TxResponse,
} from 'xrpl'
import type { ApprovedPaymentRequest, ExecutionResult } from '../domain/operations'

export interface PaymentExecutor {
  execute(request: ApprovedPaymentRequest, signal?: AbortSignal): Promise<ExecutionResult>
}

export type RlusdConfiguration = {
  testnetUrl: string
  walletSecret: string
  issuer: string
  currency: string
  vendorDestinations: Record<string, string>
}

export class XrplClient {
  readonly client: Client

  constructor(url: string) {
    if (!/test|altnet|devnet/i.test(url)) {
      throw new Error('XRPL endpoint must be an explicit Testnet or Devnet URL.')
    }
    this.client = new Client(url)
  }

  async connected<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    await this.client.connect()
    try {
      return await operation(this.client)
    } finally {
      await this.client.disconnect()
    }
  }
}

export class XrplWallet {
  readonly wallet: Wallet

  constructor(secret: string) {
    this.wallet = Wallet.fromSeed(secret)
  }

  get address(): string {
    return this.wallet.address
  }
}

export class TrustLineManager {
  constructor(
    private readonly client: XrplClient,
    private readonly wallet: XrplWallet,
    private readonly config: Pick<RlusdConfiguration, 'currency' | 'issuer'>,
  ) {}

  async establish(limit = '1000000'): Promise<string> {
    return this.client.connected(async (client) => {
      const transaction: TrustSet = {
        TransactionType: 'TrustSet',
        Account: this.wallet.address,
        LimitAmount: {
          currency: normalizeCurrency(this.config.currency),
          issuer: this.config.issuer,
          value: limit,
        },
      }
      const prepared = await client.autofill(transaction)
      const signed = this.wallet.wallet.sign(prepared)
      const result = await client.submitAndWait(signed.tx_blob)
      assertValidated(result)
      return signed.hash
    })
  }

  async balance(): Promise<string> {
    return this.client.connected(async (client) => {
      const response = await client.request({
        command: 'account_lines',
        account: this.wallet.address,
        peer: this.config.issuer,
        ledger_index: 'validated',
      })
      const line = response.result.lines.find(
        (candidate) => candidate.currency === normalizeCurrency(this.config.currency),
      )
      return line?.balance ?? '0'
    })
  }
}

export class TransactionVerifier {
  constructor(private readonly client: XrplClient) {}

  async verify(hash: string): Promise<{ validated: boolean; ledgerResult: string }> {
    return this.client.connected(async (client) => {
      const response = (await client.request({
        command: 'tx',
        transaction: hash,
        binary: false,
      })) as TxResponse
      const meta = response.result.meta
      const ledgerResult =
        typeof meta === 'object' && meta && 'TransactionResult' in meta
          ? String(meta.TransactionResult)
          : 'unknown'
      return { validated: response.result.validated === true, ledgerResult }
    })
  }
}

export class XrplPaymentExecutor implements PaymentExecutor {
  private readonly client: XrplClient
  private readonly wallet: XrplWallet
  private readonly verifier: TransactionVerifier

  constructor(private readonly config: RlusdConfiguration) {
    this.client = new XrplClient(config.testnetUrl)
    this.wallet = new XrplWallet(config.walletSecret)
    this.verifier = new TransactionVerifier(this.client)
  }

  async execute(request: ApprovedPaymentRequest): Promise<ExecutionResult> {
    const destination = this.config.vendorDestinations[request.vendor]
    if (!destination || destination !== request.destination) {
      throw new Error('Approved vendor destination is not configured.')
    }

    const submitted = await this.client.connected(async (client) => {
      const transaction: Payment = {
        TransactionType: 'Payment',
        Account: this.wallet.address,
        Destination: destination,
        Amount: {
          currency: normalizeCurrency(this.config.currency),
          issuer: this.config.issuer,
          value: request.amount.toFixed(2),
        },
      }
      const prepared = await client.autofill(transaction)
      const signed = this.wallet.wallet.sign(prepared)
      const result = await client.submitAndWait(signed.tx_blob)
      assertValidated(result)
      return signed.hash
    })
    const verification = await this.verifier.verify(submitted)
    if (!verification.validated || verification.ledgerResult !== 'tesSUCCESS') {
      throw new Error(`XRPL verification failed: ${verification.ledgerResult}`)
    }
    return {
      status: 'SUCCEEDED',
      transactionHash: submitted,
      destination,
      amount: request.amount,
      currency: request.currency,
      ledgerResult: verification.ledgerResult,
      timestamp: new Date().toISOString(),
    }
  }
}

export class SimulatedPaymentExecutor implements PaymentExecutor {
  calls = 0

  async execute(request: ApprovedPaymentRequest): Promise<ExecutionResult> {
    this.calls += 1
    return {
      status: 'SUCCEEDED',
      transactionHash: `SIMULATED-${crypto.randomUUID()}`,
      destination: request.destination,
      amount: request.amount,
      currency: request.currency,
      ledgerResult: 'tesSUCCESS',
      timestamp: new Date().toISOString(),
    }
  }
}

function normalizeCurrency(currency: string): string {
  return currency.length === 3 ? currency : convertStringToHex(currency).padEnd(40, '0').slice(0, 40)
}

function assertValidated(response: { result: { validated?: boolean; meta?: unknown } }): void {
  const meta = response.result.meta
  const result =
    typeof meta === 'object' && meta && 'TransactionResult' in meta
      ? String(meta.TransactionResult)
      : undefined
  if (response.result.validated !== true || result !== 'tesSUCCESS') {
    throw new Error(`XRPL transaction was not validated successfully (${result ?? 'unknown'}).`)
  }
}
