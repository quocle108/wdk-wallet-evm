import { ContractFactory, HDNodeWallet, JsonRpcProvider, Mnemonic } from 'ethers'

import { afterAll, afterEach, beforeEach, describe, expect, test } from '@jest/globals'

import { WalletAccountEvm } from '../../index.js'
import SeedSignerEvm from '../../src/signers/seed-signer-evm.js'
import PrivateKeySignerEvm from '../../src/signers/private-key-signer-evm.js'

import TestToken from './../artifacts/TestToken.json' with { type: 'json' }

import SimpleDelegateContract from './../artifacts/SimpleDelegateContract.json' with { type: 'json' }

const DELEGATE_CONTRACT_ADDRESS = '0xbe08D4d81EbeA77f6AA54B2067EA5F56005F98dE'

const RPC_URL = 'http://127.0.0.1:8545'

const NODE_MNEMONIC = 'anger burst story spy face pattern whale quit delay fiction ball solve'

// cacheTimeout -1: ethers' default 250ms read cache returns stale nonces under automining
const provider = new JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1 })
provider.pollingInterval = 50

const nodeSigner = HDNodeWallet
  .fromMnemonic(Mnemonic.fromPhrase(NODE_MNEMONIC), "m/44'/60'/0'/0/0")
  .connect(provider)

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

const ACCOUNT = {
  index: 0,
  path: "m/44'/60'/0'/0/0",
  address: '0x405005C7c4422390F4B334F64Cf20E0b767131d0',
  keyPair: {
    privateKey: '260905feebf1ec684f36f1599128b85f3a26c2b817f2065a2fc278398449c41f',
    publicKey: '036c082582225926b9356d95b91a4acffa3511b7cc2a14ef5338c090ea2cc3d0aa'
  }
}

const INITIAL_BALANCE = 1_000_000_000_000_000_000n
const INITIAL_TOKEN_BALANCE = 1_000_000n

async function deploySimpleDelegateContract () {
  const factory = new ContractFactory(SimpleDelegateContract.abi, SimpleDelegateContract.bytecode, nodeSigner)
  const contract = await factory.deploy()
  const transaction = await contract.deploymentTransaction()

  await transaction.wait()

  return contract
}

async function deployTestToken () {
  const factory = new ContractFactory(TestToken.abi, TestToken.bytecode, nodeSigner)
  const contract = await factory.deploy()
  const transaction = await contract.deploymentTransaction()

  await transaction.wait()

  return contract
}

describe('WalletAccountEvm', () => {
  let testToken,
    delegateContract,
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
    delegateContract = await deploySimpleDelegateContract()

    await sendEthersTo(ACCOUNT.address, INITIAL_BALANCE)

    await sendTestTokensTo(ACCOUNT.address, INITIAL_TOKEN_BALANCE)

    const root = new SeedSignerEvm(SEED_PHRASE)
    const signer = await root.derive("0'/0/0")
    account = new WalletAccountEvm(signer, { provider: RPC_URL })
  })

  afterEach(async () => {
    account.dispose()

    await provider.send('evm_revert', [snapshotId])
  })

  afterAll(() => {
    provider.destroy()
  })

  describe('sendTransaction', () => {
    test('should successfully send a transaction', async () => {
      const TRANSACTION = {
        to: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        value: 1_000
      }

      const EXPECTED_FEE = 45_868_001_678_552n

      const { hash, fee } = await account.sendTransaction(TRANSACTION)

      const transaction = await provider.getTransaction(hash)

      expect(transaction.to).toBe(TRANSACTION.to)
      expect(transaction.value).toBe(BigInt(TRANSACTION.value))

      expect(fee).toBe(EXPECTED_FEE)
    })

    test('should successfully send a transaction with PrivateKeySignerEvm', async () => {
      const pkSigner = new PrivateKeySignerEvm(ACCOUNT.keyPair.privateKey)
      const pkAccount = new WalletAccountEvm(pkSigner, { provider: RPC_URL })
      const TRANSACTION = {
        to: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        value: 1_000
      }
      const EXPECTED_FEE = 45_868_001_678_552n
      const { hash, fee } = await pkAccount.sendTransaction(TRANSACTION)
      const transaction = await provider.getTransaction(hash)
      expect(transaction.hash).toBe(hash)
      expect(transaction.to).toBe(TRANSACTION.to)
      expect(transaction.value).toBe(BigInt(TRANSACTION.value))
      expect(fee).toBe(EXPECTED_FEE)
      pkAccount.dispose()
    })

    test('should successfully send a transaction with arbitrary data', async () => {
      const TRANSACTION_WITH_DATA = {
        to: testToken.target,
        value: 0,
        data: testToken.interface.encodeFunctionData('balanceOf', ['0x636e9c21f27d9401ac180666bf8DC0D3FcEb0D24'])
      }

      const EXPECTED_FEE = 53_064_566_867_392n

      const { hash, fee } = await account.sendTransaction(TRANSACTION_WITH_DATA)

      const transaction = await provider.getTransaction(hash)

      expect(transaction.to).toBe(TRANSACTION_WITH_DATA.to)
      expect(transaction.value).toBe(BigInt(TRANSACTION_WITH_DATA.value))
      expect(transaction.data).toBe(TRANSACTION_WITH_DATA.data)

      expect(fee).toBe(EXPECTED_FEE)
    })

    test('should deploy a contract when "to" is omitted', async () => {
      const { hash } = await account.sendTransaction({
        value: 0,
        data: SimpleDelegateContract.bytecode
      })

      const receipt = await provider.getTransactionReceipt(hash)

      // A contract-creation transaction has no recipient and yields a contract address.
      expect(receipt.to).toBeNull()
      expect(receipt.contractAddress).toBeTruthy()

      const code = await provider.getCode(receipt.contractAddress)
      expect(code).not.toBe('0x')
    })

    test('should successfully send a transaction with an authorization list', async () => {
      const auth = await account.signAuthorization({
        address: DELEGATE_CONTRACT_ADDRESS
      })

      const TRANSACTION_WITH_AUTHORIZATION_LIST = {
        type: 4,
        to: account.address,
        value: 0,
        gasLimit: 100_000,
        authorizationList: [auth]
      }

      const EXPECTED_FEE = 100_470_165_478_552n

      const { hash, fee } = await account.sendTransaction(TRANSACTION_WITH_AUTHORIZATION_LIST)

      const transaction = await provider.getTransaction(hash)

      expect(transaction.to).toBe(account.address)
      expect(transaction.value).toBe(0n)
      expect(transaction.type).toBe(4)

      expect(transaction.authorizationList).toEqual([{
        address: DELEGATE_CONTRACT_ADDRESS,
        nonce: 0n,
        chainId: 1n,
        signature: expect.objectContaining({
          r: '0xa2b8fd8a79d4449081588213035817da714ea1062233ac6d3f276185408504fa',
          s: '0x0116b3fb7c6d7d7e8a084410fac2f6796a7d5810fff1415ec365d7502ac318b3',
          v: 27
        })
      }])

      expect(fee).toBe(EXPECTED_FEE)
    })
  })

  describe('transfer', () => {
    test('should successfully transfer tokens', async () => {
      const TRANSFER = {
        token: testToken.target,
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        amount: 100
      }

      const EXPECTED_FEE = 113_852_063_782_656n

      const { hash, fee } = await account.transfer(TRANSFER)
      const transaction = await provider.getTransaction(hash)
      const data = testToken.interface.encodeFunctionData('transfer', [TRANSFER.recipient, TRANSFER.amount])

      expect(transaction.to).toBe(TRANSFER.token)
      expect(transaction.value).toBe(0n)
      expect(transaction.data).toBe(data)

      expect(fee).toBe(EXPECTED_FEE)
    })

    test('should successfully transfer tokens with an authorization list', async () => {
      const auth = await account.signAuthorization({
        address: DELEGATE_CONTRACT_ADDRESS
      })

      const TRANSFER = {
        token: testToken.target,
        recipient: '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd',
        amount: 100,
        authorizationList: [auth]
      }

      const EXPECTED_FEE = 168_454_227_582_656n

      const { hash, fee } = await account.transfer(TRANSFER)
      const transaction = await provider.getTransaction(hash)
      const data = testToken.interface.encodeFunctionData('transfer', [TRANSFER.recipient, TRANSFER.amount])

      expect(transaction.to).toBe(TRANSFER.token)
      expect(transaction.value).toBe(0n)
      expect(transaction.data).toBe(data)
      expect(transaction.type).toBe(4)

      expect(transaction.authorizationList).toEqual([{
        address: DELEGATE_CONTRACT_ADDRESS,
        nonce: 0n,
        chainId: 1n,
        signature: expect.objectContaining({
          r: '0xa2b8fd8a79d4449081588213035817da714ea1062233ac6d3f276185408504fa',
          s: '0x0116b3fb7c6d7d7e8a084410fac2f6796a7d5810fff1415ec365d7502ac318b3',
          v: 27
        })
      }])

      expect(fee).toBe(EXPECTED_FEE)
    })
  })

  describe('approve', () => {
    test('should successfully approve tokens for a spender', async () => {
      const SPENDER = '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd'
      const AMOUNT = 100n

      const APPROVE_OPTIONS = {
        token: testToken.target,
        spender: SPENDER,
        amount: AMOUNT
      }

      const { hash, fee } = await account.approve(APPROVE_OPTIONS)
      const transaction = await provider.getTransaction(hash)
      const data = testToken.interface.encodeFunctionData('approve', [SPENDER, AMOUNT])

      expect(transaction.hash).toBe(hash)
      expect(transaction.to).toBe(APPROVE_OPTIONS.token)
      expect(transaction.data).toBe(data)
      expect(typeof fee).toBe('bigint')
      expect(fee).toBeGreaterThan(0n)

      const allowance = await testToken.allowance(ACCOUNT.address, SPENDER)
      expect(allowance).toBe(AMOUNT)
    })
  })

  describe('signAuthorization', () => {
    test('should successfully sign an authorization', async () => {
      const auth = await account.signAuthorization({
        address: delegateContract.target
      })

      expect(auth).toEqual({
        address: delegateContract.target,
        nonce: 0n,
        chainId: 1n,
        signature: expect.objectContaining({
          r: '0xa2b8fd8a79d4449081588213035817da714ea1062233ac6d3f276185408504fa',
          s: '0x0116b3fb7c6d7d7e8a084410fac2f6796a7d5810fff1415ec365d7502ac318b3',
          v: 27
        })
      })
    })
  })

  describe('delegate', () => {
    test('should successfully set delegation to a contract', async () => {
      const EXPECTED_FEE = 100_861_116_971_360n

      const { hash, fee } = await account.delegate(DELEGATE_CONTRACT_ADDRESS)

      const transaction = await provider.getTransaction(hash)

      expect(transaction.to).toBe(account.address)
      expect(transaction.value).toBe(0n)
      expect(transaction.type).toBe(4)

      expect(transaction.authorizationList).toEqual([{
        address: DELEGATE_CONTRACT_ADDRESS,
        nonce: 1n,
        chainId: 1n,
        signature: expect.objectContaining({
          r: '0x00834b27fe5c5cd7928aa0f97faf8ce651e0942ab763807756c5e2c2d71d912e',
          s: '0x78b7103e51a15f41d1c25c89e1cac9f754397cde5dc7674b95f6bc64ff7d01d7',
          v: 27
        })
      }])

      expect(fee).toBe(EXPECTED_FEE)
    })
  })

  describe('revokeDelegation', () => {
    test('should successfully set a delegation to the zero address', async () => {
      const EXPECTED_FEE = 100_470_165_478_552n

      const { hash, fee } = await account.revokeDelegation()

      const transaction = await provider.getTransaction(hash)

      expect(transaction.to).toBe(account.address)
      expect(transaction.value).toBe(0n)
      expect(transaction.type).toBe(4)

      expect(transaction.authorizationList).toEqual([{
        address: '0x0000000000000000000000000000000000000000',
        nonce: 1n,
        chainId: 1n,
        signature: expect.objectContaining({
          r: '0xc58040c5a751ef2a3a2e9b95f95bf400e65a284661cca59c28868de0fef9c11b',
          s: '0x4ef4cfd278836602291b26baffac20e7d0601e8634a3b92de513d7d6dddd8fd8',
          v: 27
        })
      }])

      expect(fee).toBe(EXPECTED_FEE)
    })
  })
})
