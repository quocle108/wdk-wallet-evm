import { ContractFactory, HDNodeWallet, JsonRpcProvider, JsonRpcSigner, Mnemonic } from 'ethers'

import { afterAll, afterEach, beforeEach, describe, expect, test } from '@jest/globals'

import { WalletAccountReadOnlyEvm } from '../../index.js'

import TestToken from './../artifacts/TestToken.json' with { type: 'json' }

const ADDRESS = '0x405005C7c4422390F4B334F64Cf20E0b767131d0'

const RPC_URL = 'http://127.0.0.1:8545'

const NODE_MNEMONIC = 'anger burst story spy face pattern whale quit delay fiction ball solve'

// cacheTimeout -1: ethers' default 250ms read cache returns stale nonces under automining
const provider = new JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1 })
provider.pollingInterval = 50

const nodeSigner = HDNodeWallet
  .fromMnemonic(Mnemonic.fromPhrase(NODE_MNEMONIC), "m/44'/60'/0'/0/0")
  .connect(provider)

const INITIAL_BALANCE = 1_000_000_000_000_000_000n
const INITIAL_TOKEN_BALANCE = 1_000_000n

async function deployTestToken () {
  const factory = new ContractFactory(TestToken.abi, TestToken.bytecode, nodeSigner)
  const contract = await factory.deploy()
  const transaction = await contract.deploymentTransaction()

  await transaction.wait()

  return contract
}

describe('WalletAccountReadOnlyEvm', () => {
  let testToken,
    account,
    snapshotId

  async function sendEthersTo (to, value) {
    const transaction = await nodeSigner.sendTransaction({ to, value })
    await transaction.wait()
  }

  async function sendTestTokensTo (to, value) {
    const transaction = await testToken.transfer(to, value)
    await transaction.wait()
  }

  beforeEach(async () => {
    snapshotId = await provider.send('evm_snapshot', [])

    testToken = await deployTestToken()

    await sendEthersTo(ADDRESS, INITIAL_BALANCE)

    await sendTestTokensTo(ADDRESS, INITIAL_TOKEN_BALANCE)

    account = new WalletAccountReadOnlyEvm(ADDRESS, {
      provider: RPC_URL
    })
  })

  afterEach(async () => {
    await provider.send('evm_revert', [snapshotId])
  })

  afterAll(() => {
    provider.destroy()
  })

  describe('getBalance', () => {
    test('should return the correct balance of the account', async () => {
      const balance = await account.getBalance()

      expect(balance).toBe(INITIAL_BALANCE)
    })
  })

  describe('getTokenBalance', () => {
    test('should return the correct token balance of the account', async () => {
      const balance = await account.getTokenBalance(testToken.target)

      expect(balance).toBe(INITIAL_TOKEN_BALANCE)
    })
  })

  describe('getTokenBalances', () => {
    test('should return the correct token balances of the account', async () => {
      const testToken2 = await deployTestToken()
      const transaction = await testToken2.transfer(
        ADDRESS,
        INITIAL_TOKEN_BALANCE * 2n
      )
      await transaction.wait()

      const balances = await account.getTokenBalances([
        testToken.target,
        testToken2.target
      ])

      expect(balances).toEqual({
        [testToken.target]: INITIAL_TOKEN_BALANCE,
        [testToken2.target]: INITIAL_TOKEN_BALANCE * 2n
      })
    })
  })

  describe('quoteSendTransaction', () => {
    test('should successfully quote a transaction', async () => {
      const TRANSACTION = {
        to: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        value: 1_000
      }

      const EXPECTED_FEE = 49_375_497_680_218n

      const { fee } = await account.quoteSendTransaction(TRANSACTION)

      expect(fee).toBe(EXPECTED_FEE)
    })

    test('should successfully quote a transaction with arbitrary data', async () => {
      const TRANSACTION_WITH_DATA = {
        to: testToken.target,
        value: 0,
        data: testToken.interface.encodeFunctionData('balanceOf', ['0x636e9c21f27d9401ac180666bf8DC0D3FcEb0D24'])
      }

      const EXPECTED_FEE = 57_122_379_488_528n

      const { fee } = await account.quoteSendTransaction(TRANSACTION_WITH_DATA)

      expect(fee).toBe(EXPECTED_FEE)
    })

    test('should successfully quote a transaction with an authorization list', async () => {
      const TRANSACTION_WITH_AUTHORIZATION_LIST = {
        to: ADDRESS,
        value: 0,
        authorizationList: [{
          address: testToken.target,
          nonce: 0n,
          chainId: 31_337n,
          signature: '0x8350369e5b5aad1a0feade6d6549fe5494cfc6e4368dcebfbeb2ca7c684dfe33566860606b1c76dbaf823db90ad4d1cd79f97a486140fa9af801cb7f315ad4761c'
        }]
      }

      const EXPECTED_FEE = 108_153_053_130_218n

      const { fee } = await account.quoteSendTransaction(TRANSACTION_WITH_AUTHORIZATION_LIST)

      expect(fee).toBe(EXPECTED_FEE)
    })
  })

  describe('quoteTransfer', () => {
    test('should successfully quote a transfer operation', async () => {
      const TRANSFER = {
        token: testToken.target,
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        amount: 100
      }

      const EXPECTED_FEE = 122_558_256_419_904n

      const { fee } = await account.quoteTransfer(TRANSFER)

      expect(fee).toBe(EXPECTED_FEE)
    })
  })

  describe('getTransactionReceipt', () => {
    test('should return the correct transaction receipt', async () => {
      const TRANSACTION = {
        to: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        value: 0
      }

      const { hash } = await nodeSigner.sendTransaction(TRANSACTION)

      const receipt = await account.getTransactionReceipt(hash)

      expect(receipt.hash).toBe(hash)
      expect(receipt.to).toBe(TRANSACTION.to)
      expect(receipt.status).toBe(1)
    })

    test('should return null if the transaction has not been included in a block yet', async () => {
      const HASH = '0xe60970cd7685466037bac1ff337e08265ac9f48af70a12529bdca5caf5a2b14b'

      const receipt = await account.getTransactionReceipt(HASH)

      expect(receipt).toBe(null)
    })
  })

  describe('getAllowance', () => {
    const SPENDER_ADDRESS = '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd'

    test('should return 0n when no allowance has been set', async () => {
      const allowance = await account.getAllowance(testToken.target, SPENDER_ADDRESS)

      expect(allowance).toEqual(0n)
    })

    test('should return the correct allowance after it has been set', async () => {
      const allowanceAmount = 500_000n

      await provider.send('hardhat_impersonateAccount', [ADDRESS])
      const ownerSigner = new JsonRpcSigner(provider, ADDRESS)

      const approveTx = await testToken.connect(ownerSigner).approve(SPENDER_ADDRESS, allowanceAmount)
      await approveTx.wait()

      const allowance = await account.getAllowance(testToken.target, SPENDER_ADDRESS)

      expect(allowance).toBe(allowanceAmount)
    })
  })

  describe('getDelegation', () => {
    test('should return false for a regular EOA', async () => {
      const delegation = await account.getDelegation()

      expect(delegation).toEqual({
        isDelegated: false,
        delegateAddress: null
      })
    })

    test('should return true for a delegated EOA', async () => {
      const DELEGATE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678'

      const designator = '0xef0100' + DELEGATE_ADDRESS.slice(2)

      await provider.send('hardhat_setCode', [ADDRESS, designator])

      const delegation = await account.getDelegation()

      expect(delegation).toEqual({
        isDelegated: true,
        delegateAddress: DELEGATE_ADDRESS
      })
    })
  })
})
