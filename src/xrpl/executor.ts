import {
  Client,
  Wallet,
  convertStringToHex,
  isValidClassicAddress,
  type Payment,
  type TrustSet,
  type TxResponse,
} from 'xrpl'
import type { ApprovedPaymentRequest, ExecutionResult } from '../domain/operations'

export interface PaymentExecutor {
  readonly mode?: 'SIMULATED' | 'TESTNET'
  readonly providerId?: string
  execute(request: ApprovedPaymentRequest, signal?: AbortSignal, transition?: (state: 'SUBMITTED' | 'VALIDATING') => Promise<void>): Promise<ExecutionResult>
}
export interface PaymentProvider extends PaymentExecutor {
  readonly providerId: string
  readonly displayName: string
  readonly supportedCurrencies: readonly string[]
  readonly supportedActions: readonly string[]
  authorize(request: ApprovedPaymentRequest): Promise<ApprovedPaymentRequest>
  getStatus(request: ApprovedPaymentRequest, transactionHash: string): Promise<'SUCCEEDED' | 'FAILED' | 'UNKNOWN'>
  reconcile(request: ApprovedPaymentRequest, transactionHash: string): Promise<'SUCCEEDED' | 'FAILED' | 'UNKNOWN'>
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
    if (url !== 'wss://s.altnet.rippletest.net:51233') {
      throw new Error('XRPL endpoint must be the approved Testnet URL.')
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
  ) {
    if (!isValidClassicAddress(config.issuer) || config.currency !== 'RLUSD') throw new Error('XRPL asset configuration is invalid.')
  }

  async establish(limit = '1000000'): Promise<string> {
    return this.client.connected(async (client) => {
      const existing = await client.request({ command: 'account_lines', account: this.wallet.address, peer: this.config.issuer, ledger_index: 'validated' })
      if (existing.result.lines.some((line) => line.currency === normalizeCurrency(this.config.currency) && Number(line.limit) > 0)) {
        return 'ALREADY_ESTABLISHED'
      }
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

  async verify(hash: string, expected: ApprovedPaymentRequest, sender: string, issuer: string): Promise<{ validated: boolean; ledgerResult: string }> {
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
      type LedgerPayment = { TransactionType?: string; Account?: string; Destination?: string; Amount?: { currency?: string; issuer?: string; value?: string } }
      const transaction = response.result as unknown as { tx_json?: LedgerPayment; tx?: LedgerPayment }
      const tx = transaction.tx_json ?? transaction.tx
      const matches = tx?.TransactionType === 'Payment' && tx.Account === sender && tx.Destination === expected.destination && tx.Amount?.currency === normalizeCurrency(expected.currency) && tx.Amount?.issuer === issuer && Number(tx.Amount?.value) === expected.amount
      return { validated: response.result.validated === true && matches, ledgerResult }
    })
  }
}

export class XrplPaymentExecutor implements PaymentProvider {
  readonly mode = 'TESTNET' as const
  readonly providerId = 'xrpl-testnet'
  readonly displayName = 'XRPL Testnet'
  readonly supportedCurrencies = ['RLUSD'] as const
  readonly supportedActions = ['purchase_storage'] as const
  private readonly client: XrplClient
  private readonly wallet: XrplWallet
  private readonly verifier: TransactionVerifier

  constructor(private readonly config: RlusdConfiguration) {
    if (!isValidClassicAddress(config.issuer) || config.currency !== 'RLUSD') throw new Error('XRPL asset configuration is invalid.')
    this.client = new XrplClient(config.testnetUrl)
    this.wallet = new XrplWallet(config.walletSecret)
    this.verifier = new TransactionVerifier(this.client)
  }

  async execute(request: ApprovedPaymentRequest, _signal?: AbortSignal, transition?: (state: 'SUBMITTED' | 'VALIDATING') => Promise<void>): Promise<ExecutionResult> {
    const destination = this.config.vendorDestinations[request.vendor]
    if (!destination || destination !== request.destination || !isValidClassicAddress(destination) || request.currency !== 'RLUSD' || !Number.isFinite(request.amount) || request.amount <= 0 || !request.actionId || !request.policyVersion || Number.isNaN(Date.parse(request.policyApprovedAt))) {
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
      let result
      try { await transition?.('SUBMITTED'); result = await client.submitAndWait(signed.tx_blob); await transition?.('VALIDATING') }
      catch { throw new SubmissionUnknownError(signed.hash) }
      assertValidated(result)
      return signed.hash
    })
    const verification = await this.verifier.verify(submitted, request, this.wallet.address, this.config.issuer)
    if (!verification.validated || verification.ledgerResult !== 'tesSUCCESS') {
      throw new Error(`XRPL verification failed: ${verification.ledgerResult}`)
    }
    return {
      status: 'SUCCEEDED',
      mode: 'TESTNET',
      transactionHash: submitted,
      destination,
      amount: request.amount,
      currency: request.currency,
      ledgerResult: verification.ledgerResult,
      timestamp: new Date().toISOString(),
    }
  }
  async authorize(request: ApprovedPaymentRequest) { if (request.providerId !== this.providerId || request.authorizationScope !== 'infrastructure:purchase') throw new Error('Provider authorization is invalid.'); return request }
  async getStatus(request: ApprovedPaymentRequest, transactionHash: string) { const result = await this.verifier.verify(transactionHash, request, this.wallet.address, this.config.issuer); return result.validated ? result.ledgerResult === 'tesSUCCESS' ? 'SUCCEEDED' as const : 'FAILED' as const : 'UNKNOWN' as const }
  async reconcile(request: ApprovedPaymentRequest, transactionHash: string) { return this.getStatus(request, transactionHash) }
}

export class SimulatedPaymentExecutor implements PaymentProvider {
  readonly mode = 'SIMULATED' as const
  readonly providerId = 'xrpl-testnet'
  readonly displayName = 'XRPL Simulation'
  readonly supportedCurrencies = ['RLUSD'] as const
  readonly supportedActions = ['purchase_storage'] as const
  calls = 0

  async execute(request: ApprovedPaymentRequest, _signal?: AbortSignal, transition?: (state: 'SUBMITTED' | 'VALIDATING') => Promise<void>): Promise<ExecutionResult> {
    this.calls += 1
    await transition?.('SUBMITTED')
    await transition?.('VALIDATING')
    return {
      status: 'SUCCEEDED',
      mode: 'SIMULATED',
      transactionHash: `SIMULATED-${crypto.randomUUID()}`,
      destination: request.destination,
      amount: request.amount,
      currency: request.currency,
      ledgerResult: 'tesSUCCESS',
      timestamp: new Date().toISOString(),
    }
  }
  async authorize(request: ApprovedPaymentRequest) { return request }
  async getStatus() { return 'SUCCEEDED' as const }
  async reconcile() { return 'SUCCEEDED' as const }
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
    if (response.result.validated === true && result && result !== 'tesSUCCESS') throw new DefinitivePaymentError(result)
    throw new Error(`XRPL transaction validation is unknown (${result ?? 'unknown'}).`)
  }
}

export class SubmissionUnknownError extends Error {
  constructor(readonly transactionHash: string) { super('XRPL submission outcome is unknown.') }
}

export class DefinitivePaymentError extends Error {
  constructor(readonly ledgerResult: string) { super(`XRPL rejected the transaction (${ledgerResult}).`) }
}
