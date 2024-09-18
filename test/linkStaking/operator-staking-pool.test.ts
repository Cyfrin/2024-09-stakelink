import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  getAccounts,
  setupToken,
  fromEther,
  deployUpgradeable,
} from '../utils/helpers'
import { LSTMock, OperatorStakingPool } from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('OperatorStakingPool', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()

    const lst = (await deploy('LSTMock', ['test', 'test', 1000000000])) as LSTMock
    await setupToken(lst, accounts)

    const opPool = (await deployUpgradeable('OperatorStakingPool', [
      lst.target,
      toEther(75000),
    ])) as OperatorStakingPool

    await opPool.addOperators([accounts[0], accounts[1], accounts[2]])

    return { signers, accounts, lst, opPool }
  }

  it('onTokenTransfer should work correctly', async () => {
    const { signers, accounts, opPool, lst } = await loadFixture(deployFixture)

    await expect(opPool.onTokenTransfer(accounts[0], 1000, '0x')).to.be.revertedWithCustomError(
      opPool,
      'InvalidToken()'
    )
    await expect(
      lst.connect(signers[3]).transferAndCall(opPool.target, toEther(1000), '0x')
    ).to.be.revertedWithCustomError(opPool, 'SenderNotAuthorized()')

    await lst.transferAndCall(opPool.target, toEther(1000), '0x')
    await lst.setMultiplierBasisPoints(20000)
    await lst.connect(signers[1]).transferAndCall(opPool.target, toEther(500), '0x')

    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[0])), 2000)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[0])), 2000)
    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[1])), 500)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[1])), 500)
    assert.equal(fromEther(await opPool.getTotalPrincipal()), 2500)
    assert.equal(fromEther(await opPool.getTotalStaked()), 2500)

    await expect(
      lst.transferAndCall(opPool.target, toEther(75000), '0x')
    ).to.be.revertedWithCustomError(opPool, 'ExceedsDepositLimit()')

    await lst.transferAndCall(opPool.target, toEther(73000), '0x')
    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[0])), 75000)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[0])), 75000)
    assert.equal(fromEther(await opPool.getTotalPrincipal()), 75500)
    assert.equal(fromEther(await opPool.getTotalStaked()), 75500)

    await lst.setMultiplierBasisPoints(30000)
    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[0])), 75000)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[0])), 112500)
    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[1])), 750)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[1])), 750)
    assert.equal(fromEther(await opPool.getTotalPrincipal()), 75750)
    assert.equal(fromEther(await opPool.getTotalStaked()), 113250)
  })

  it('withdraw should work correctly', async () => {
    const { signers, accounts, opPool, lst } = await loadFixture(deployFixture)

    await lst.transferAndCall(opPool.target, toEther(1000), '0x')
    await lst.connect(signers[1]).transferAndCall(opPool.target, toEther(500), '0x')

    await expect(opPool.connect(signers[3]).withdraw(toEther(100))).to.be.revertedWithCustomError(
      opPool,
      'SenderNotAuthorized()'
    )

    await opPool.withdraw(toEther(1000))
    await opPool.connect(signers[1]).withdraw(toEther(200))
    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[0])), 0)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[0])), 0)
    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[1])), 300)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[1])), 300)
    assert.equal(fromEther(await opPool.getTotalPrincipal()), 300)
    assert.equal(fromEther(await opPool.getTotalStaked()), 300)

    await lst.setMultiplierBasisPoints(20000)
    await opPool.connect(signers[1]).withdraw(toEther(500))
    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[0])), 0)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[0])), 0)
    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[1])), 100)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[1])), 100)
    assert.equal(fromEther(await opPool.getTotalPrincipal()), 100)
    assert.equal(fromEther(await opPool.getTotalStaked()), 100)
  })

  it('addOperators should work correctly', async () => {
    const { accounts, opPool } = await loadFixture(deployFixture)

    await opPool.addOperators([accounts[5], accounts[6]])

    assert.deepEqual(await opPool.getOperators(), [
      accounts[0],
      accounts[1],
      accounts[2],
      accounts[5],
      accounts[6],
    ])
    assert.equal(await opPool.isOperator(accounts[1]), true)

    await expect(opPool.addOperators([accounts[7], accounts[6]])).to.be.revertedWithCustomError(
      opPool,
      'OperatorAlreadyAdded()'
    )
  })

  it('removeOperators should work correctly', async () => {
    const { signers, accounts, opPool, lst } = await loadFixture(deployFixture)

    await lst.transferAndCall(opPool.target, toEther(1000), '0x')
    await lst.connect(signers[1]).transferAndCall(opPool.target, toEther(500), '0x')
    await opPool.removeOperators([accounts[0], accounts[2]])

    assert.deepEqual(await opPool.getOperators(), [accounts[1]])
    assert.equal(await opPool.isOperator(accounts[0]), false)
    assert.equal(await opPool.isOperator(accounts[1]), true)
    assert.equal(await opPool.isOperator(accounts[2]), false)

    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[0])), 0)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[0])), 0)
    assert.equal(fromEther(await opPool.getOperatorPrincipal(accounts[1])), 500)
    assert.equal(fromEther(await opPool.getOperatorStaked(accounts[1])), 500)
    assert.equal(fromEther(await opPool.getTotalPrincipal()), 500)
    assert.equal(fromEther(await opPool.getTotalStaked()), 500)

    await expect(opPool.removeOperators([accounts[0], accounts[1]])).to.be.revertedWithCustomError(
      opPool,
      'OperatorNotFound()'
    )
  })
})
