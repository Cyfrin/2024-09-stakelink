import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  deploy,
  padBytes,
  concatBytes,
  getAccounts,
  toEther,
  fromEther,
  deployUpgradeable,
} from '../utils/helpers'
import {
  ERC677,
  EthStakingStrategyMock,
  NWLOperatorController,
  RewardsPool,
} from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const pubkeyLength = 48 * 2
const signatureLength = 96 * 2

const keyPairs = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48), padBytes('0xa3', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96), padBytes('0xb3', 96)]),
}

describe('NWLOperatorController', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
    const adrs: any = {}

    const wsdToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'test',
      'test',
      100000,
    ])) as ERC677
    adrs.wsdToken = await wsdToken.getAddress()

    const controller = (await deployUpgradeable('NWLOperatorController', [
      accounts[0],
      adrs.wsdToken,
    ])) as NWLOperatorController
    adrs.controller = await controller.getAddress()

    const setupController = async (ctrlr: NWLOperatorController) => {
      const rewardsPool = (await deploy('RewardsPool', [
        await ctrlr.getAddress(),
        adrs.wsdToken,
      ])) as RewardsPool

      await ctrlr.setRewardsPool(await rewardsPool.getAddress())
      await ctrlr.setKeyValidationOracle(accounts[0])
      await ctrlr.setBeaconOracle(accounts[0])

      for (let i = 0; i < 5; i++) {
        await ctrlr.addOperator('test')
        await ctrlr.addKeyPairs(i, 3, keyPairs.keys, keyPairs.signatures, {
          value: toEther(16 * 3),
        })
        if (i % 2 == 0) {
          await ctrlr.initiateKeyPairValidation(accounts[0], i)
          await ctrlr.reportKeyPairValidation(i, true)
        }
      }

      return rewardsPool
    }

    const rewardsPool = await setupController(controller)
    adrs.rewardsPool = await rewardsPool.getAddress()

    return { signers, accounts, adrs, wsdToken, controller, rewardsPool, setupController }
  }

  it('addOperator should work correctly', async () => {
    const { accounts, controller } = await loadFixture(deployFixture)

    await controller.addOperator('Testing123')
    let op = (await controller.getOperators([5]))[0]

    assert.equal(op[0], 'Testing123', 'operator name incorrect')
    assert.equal(op[1], accounts[0], 'operator owner incorrect')
    assert.equal(op[2], true, 'operator active incorrect')
    assert.equal(op[3], false, 'operator keyValidationInProgress incorrect')
    assert.equal(Number(op[4]), 0, 'operator validatorLimit incorrect')
    assert.equal(Number(op[5]), 0, 'operator stoppedValidators incorrect')
    assert.equal(Number(op[6]), 0, 'operator totalKeyPairs incorrect')
    assert.equal(Number(op[7]), 0, 'operator usedKeyPairs incorrect')
  })

  it('addKeyPairs should work correctly', async () => {
    const { signers, adrs, controller } = await loadFixture(deployFixture)

    await controller.addOperator('Testing123')
    await controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })
    let op = (await controller.getOperators([5]))[0]

    assert.equal(Number(op[4]), 0, 'operator validatorLimit incorrect')
    assert.equal(Number(op[6]), 3, 'operator totalKeyPairs incorrect')
    assert.equal(Number(op[7]), 0, 'operator usedKeyPairs incorrect')

    assert.equal(fromEther(await ethers.provider.getBalance(adrs.controller)), 3 * 16 + 5 * 3 * 16)

    await expect(
      controller.connect(signers[1]).addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures)
    ).to.be.revertedWith('Sender is not operator owner')
    await expect(
      controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures, { value: toEther(16) })
    ).to.be.revertedWith('Incorrect stake amount')
    await expect(
      controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures, { value: toEther(4 * 16) })
    ).to.be.revertedWith('Incorrect stake amount')
  })

  it('reportKeyPairValidation should work correctly', async () => {
    const { signers, accounts, controller } = await loadFixture(deployFixture)

    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })
    await controller.initiateKeyPairValidation(accounts[0], 2)

    await expect(
      controller.connect(signers[1]).reportKeyPairValidation(2, true)
    ).to.be.revertedWith('Sender is not key validation oracle')

    let op = (await controller.getOperators([2]))[0]

    assert.equal(Number(op[4]), 3, 'operator validatorLimit incorrect')
    assert.equal(op[3], true, 'operator keyValidationInProgress incorrect')

    await controller.reportKeyPairValidation(2, true)

    op = (await controller.getOperators([2]))[0]

    assert.equal(Number(op[4]), 6, 'operator validatorLimit incorrect')
    assert.equal(op[3], false, 'operator keyValidationInProgress incorrect')

    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })
    await controller.initiateKeyPairValidation(accounts[0], 2)
    await controller.reportKeyPairValidation(2, false)

    op = (await controller.getOperators([2]))[0]

    assert.equal(Number(op[4]), 6, 'operator validatorLimit incorrect')
    assert.equal(op[3], false, 'operator keyValidationInProgress incorrect')

    let queue = await controller.getQueueEntries(0, 100)
    assert.equal(queue.length, 4, 'queue.length incorrect')
    assert.deepEqual(
      queue[3].map((v) => Number(v)),
      [2, 3],
      'queue entry incorrect'
    )

    assert.equal(Number(await controller.queueLength()), 12, 'queueLength incorrect')

    await expect(controller.reportKeyPairValidation(2, true)).to.be.revertedWith(
      'No key validation in progress'
    )
  })

  it('removeKeyPairs should work correctly', async () => {
    const { signers, accounts, adrs, controller } = await loadFixture(deployFixture)

    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })
    await controller.initiateKeyPairValidation(accounts[0], 2)
    await controller.reportKeyPairValidation(2, true)
    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })

    await controller.assignNextValidators(4)

    await expect(controller.removeKeyPairs(5, 2, [5])).to.be.revertedWith('Operator does not exist')
    await expect(controller.connect(signers[1]).removeKeyPairs(4, 2, [4])).to.be.revertedWith(
      'Sender is not operator owner'
    )
    await expect(controller.removeKeyPairs(2, 0, [1])).to.be.revertedWith(
      'Quantity must be greater than 0'
    )
    await expect(controller.removeKeyPairs(2, 10, [1])).to.be.revertedWith(
      'Cannot remove used key pairs or more keys than are added'
    )
    await expect(controller.removeKeyPairs(2, 9, [1])).to.be.revertedWith(
      'Cannot remove used key pairs or more keys than are added'
    )
    await expect(controller.removeKeyPairs(2, 4, [0])).to.be.revertedWith(
      'Cannot remove from queue entry that is already passed by'
    )
    await expect(controller.removeKeyPairs(2, 7, [1, 4])).to.be.revertedWith(
      'Cannot remove from queue entry that does not exist'
    )

    await controller.removeKeyPairs(2, 7, [1, 3])

    let op = (await controller.getOperators([2]))[0]
    assert.equal(Number(op[4]), 2, 'operator validatorLimit incorrect')
    assert.equal(Number(op[6]), 2, 'operator totalKeyPairs incorrect')
    assert.equal(Number(op[7]), 1, 'operator usedKeyPairs incorrect')

    let queue = await controller.getQueueEntries(0, 100)
    assert.equal(queue.length, 4, 'queue.length incorrect')
    assert.deepEqual(
      queue[1].map((v) => Number(v)),
      [2, 0],
      'queue entry incorrect'
    )
    assert.deepEqual(
      queue[3].map((v) => Number(v)),
      [2, 1],
      'queue entry incorrect'
    )

    assert.equal(Number(await controller.queueLength()), 4, 'queueLength incorrect')
    assert.equal(fromEther(await ethers.provider.getBalance(adrs.controller)), 16 * 10)
  })

  it('assignNextValidators should work correctly', async () => {
    const { signers, accounts, controller } = await loadFixture(deployFixture)

    let vals = await controller.assignNextValidators.staticCall(5)
    assert.equal(
      vals[0],
      keyPairs.keys + keyPairs.keys.slice(2, 2 * pubkeyLength + 2),
      'assigned keys incorrect'
    )
    assert.equal(
      vals[1],
      keyPairs.signatures + keyPairs.signatures.slice(2, 2 * signatureLength + 2),
      'assigned signatures incorrect'
    )

    await controller.assignNextValidators(5)

    let ops = await controller.getOperators([0, 1, 2, 3, 4])
    assert.equal(Number(ops[0][7]), 3, 'Operator0 usedKeyPairs incorrect')
    assert.equal(Number(ops[1][7]), 0, 'Operator1 usedKeyPairs incorrect')
    assert.equal(Number(ops[2][7]), 2, 'Operator2 usedKeyPairs incorrect')
    assert.equal(Number(ops[3][7]), 0, 'Operator3 usedKeyPairs incorrect')
    assert.equal(Number(ops[4][7]), 0, 'Operator4 usedKeyPairs incorrect')
    assert.equal(
      Number(await controller.totalActiveValidators()),
      5,
      'totalActiveValidators incorrect'
    )
    assert.equal(
      fromEther(await controller.totalActiveStake()),
      5 * 16,
      'totalActiveStake incorrect'
    )
    assert.equal(Number(await controller.queueIndex()), 1, 'queueIndex incorrect')
    assert.equal(Number(await controller.queueLength()), 4, 'queueLength incorrect')
    assert.equal(
      Number(await controller.totalAssignedValidators()),
      5,
      'totalAssignedValidators incorrect'
    )

    assert.equal(Number(await controller.staked(accounts[0])), 5, 'operator staked incorrect')
    assert.equal(Number(await controller.totalStaked()), 5, 'totalStaked incorrect')

    let queue = await controller.getQueueEntries(0, 100)
    assert.deepEqual(
      queue[1].map((v) => Number(v)),
      [2, 1],
      'queue entry incorrect'
    )

    await expect(controller.assignNextValidators(5)).to.be.revertedWith(
      'Cannot assign more than queue length'
    )

    vals = await controller.assignNextValidators.staticCall(4)
    assert.equal(
      vals[0],
      '0x' + keyPairs.keys.slice(2 * pubkeyLength + 2) + keyPairs.keys.slice(2),
      'assigned keys incorrect'
    )
    assert.equal(
      vals[1],
      '0x' + keyPairs.signatures.slice(2 * signatureLength + 2) + keyPairs.signatures.slice(2),
      'assigned signatures incorrect'
    )

    await controller.assignNextValidators(4)

    ops = await controller.getOperators([0, 1, 2, 3, 4])
    assert.equal(Number(ops[0][7]), 3, 'Operator0 usedKeyPairs incorrect')
    assert.equal(Number(ops[1][7]), 0, 'Operator1 usedKeyPairs incorrect')
    assert.equal(Number(ops[2][7]), 3, 'Operator2 usedKeyPairs incorrect')
    assert.equal(Number(ops[3][7]), 0, 'Operator3 usedKeyPairs incorrect')
    assert.equal(Number(ops[4][7]), 3, 'Operator4 usedKeyPairs incorrect')
    assert.equal(
      Number(await controller.totalActiveValidators()),
      9,
      'totalActiveValidators incorrect'
    )
    assert.equal(
      fromEther(await controller.totalActiveStake()),
      9 * 16,
      'totalActiveStake incorrect'
    )
    assert.equal(Number(await controller.queueIndex()), 3, 'queueIndex incorrect')
    assert.equal(Number(await controller.queueLength()), 0, 'queueLength incorrect')
    assert.equal(
      Number(await controller.totalAssignedValidators()),
      9,
      'totalAssignedValidators incorrect'
    )

    assert.equal(Number(await controller.staked(accounts[0])), 9, 'operator staked incorrect')
    assert.equal(Number(await controller.totalStaked()), 9, 'totalStaked incorrect')

    await expect(controller.connect(signers[1]).assignNextValidators(1)).to.be.revertedWith(
      'Sender is not ETH staking strategy'
    )
  })

  it('getNextValidators should work correctly', async () => {
    const { controller } = await loadFixture(deployFixture)

    let keys = await controller.getNextValidators(5)
    assert.equal(
      keys,
      keyPairs.keys + keyPairs.keys.slice(2, 2 * pubkeyLength + 2),
      'keys incorrect'
    )

    await controller.assignNextValidators(2)

    keys = await controller.getNextValidators(5)
    assert.equal(
      keys,
      '0x' +
        keyPairs.keys.slice(2 * pubkeyLength + 2, 3 * pubkeyLength + 2) +
        keyPairs.keys.slice(2) +
        keyPairs.keys.slice(2, pubkeyLength + 2),
      'keys incorrect'
    )

    await controller.assignNextValidators(1)

    keys = await controller.getNextValidators(5)
    assert.equal(
      keys,
      keyPairs.keys + keyPairs.keys.slice(2, 2 * pubkeyLength + 2),
      'keys incorrect'
    )
  })

  it('getNextValidators should work correctly with duplicate operators in queue', async () => {
    const { accounts, controller } = await loadFixture(deployFixture)

    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })
    await controller.initiateKeyPairValidation(accounts[0], 2)
    await controller.reportKeyPairValidation(2, true)

    await controller.removeKeyPairs(2, 2, [1, 3])
    await controller.addKeyPairs(2, 3, keyPairs.keys, keyPairs.signatures, {
      value: toEther(3 * 16),
    })

    let keys = await controller.getNextValidators(9)
    assert.equal(
      keys,
      keyPairs.keys +
        keyPairs.keys.slice(2, pubkeyLength + 2) +
        keyPairs.keys.slice(2) +
        keyPairs.keys.slice(pubkeyLength + 2),
      'keys incorrect'
    )
  })

  it('reportStoppedValidators should work correctly', async () => {
    const { signers, accounts, controller } = await loadFixture(deployFixture)

    await controller.assignNextValidators(8)
    await controller.reportStoppedValidators([0, 4], [2, 1], [toEther(4), toEther(1)])

    let op = await controller.getOperators([0, 2, 4])
    assert.equal(Number(op[0][5]), 2, 'operator stoppedValidators incorrect')
    assert.equal(Number(op[1][5]), 0, 'operator stoppedValidators incorrect')
    assert.equal(Number(op[2][5]), 1, 'operator stoppedValidators incorrect')

    assert.equal(fromEther(await controller.ethLost(0)), 4, 'operator ethLost incorrect')
    assert.equal(fromEther(await controller.ethLost(2)), 0, 'operator ethLost incorrect')
    assert.equal(fromEther(await controller.ethLost(4)), 1, 'operator ethLost incorrect')

    assert.equal(fromEther(await controller.totalActiveStake()), 80, 'totalActiveStake incorrect')
    assert.equal(
      Number(await controller.totalActiveValidators()),
      5,
      'totalActiveValidators incorrect'
    )
    assert.equal(Number(await controller.staked(accounts[0])), 5, 'operator staked incorrect')
    assert.equal(Number(await controller.totalStaked()), 5, 'totalStaked incorrect')

    await expect(
      controller.reportStoppedValidators([0, 5], [3, 1], [toEther(4), toEther(1)])
    ).to.be.revertedWith('Operator does not exist')
    await expect(
      controller
        .connect(signers[1])
        .reportStoppedValidators([0, 4], [3, 2], [toEther(4), toEther(1)])
    ).to.be.revertedWith('Sender is not beacon oracle')
    await expect(
      controller.reportStoppedValidators([0, 4], [1, 3], [toEther(4), toEther(1)])
    ).to.be.revertedWith('Reported negative or zero stopped validators')
    await expect(
      controller.reportStoppedValidators([0, 4], [3, 0], [toEther(4), toEther(1)])
    ).to.be.revertedWith('Reported negative or zero stopped validators')
    await expect(controller.reportStoppedValidators([0], [3], [toEther(1)])).to.be.revertedWith(
      'Reported negative lost ETH'
    )
    await expect(
      controller.reportStoppedValidators([0, 4], [4, 3], [toEther(4), toEther(1)])
    ).to.be.revertedWith('Reported more stopped validators than active')
    await expect(controller.reportStoppedValidators([4], [2], [toEther(18)])).to.be.revertedWith(
      'Reported more than max loss of 16 ETH per validator'
    )
  })

  it('RewardsPoolController functions should work', async () => {
    const { accounts, adrs, controller, rewardsPool, wsdToken } = await loadFixture(deployFixture)

    await controller.setOperatorOwner(2, accounts[2])
    await controller.setOperatorOwner(4, accounts[4])
    await controller.assignNextValidators(8)
    await wsdToken.transferAndCall(adrs.rewardsPool, toEther(100), '0x00')

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[0])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[2])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[4])),
      25,
      'rewards pool account balance incorrect'
    )

    await controller.reportStoppedValidators([0, 4], [1, 2], [0, 0])

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[0])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[2])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[4])),
      25,
      'rewards pool account balance incorrect'
    )

    await controller.assignNextValidators(1)

    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[0])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[2])),
      37.5,
      'rewards pool account balance incorrect'
    )
    assert.equal(
      fromEther(await rewardsPool.withdrawableRewards(accounts[4])),
      25,
      'rewards pool account balance incorrect'
    )
  })

  it('withdrawableStake and withdrawStake should work correctly', async () => {
    const { signers, adrs, setupController } = await loadFixture(deployFixture)

    const strategy = (await deploy('EthStakingStrategyMock')) as EthStakingStrategyMock
    const controller = (await deployUpgradeable('NWLOperatorController', [
      await strategy.getAddress(),
      adrs.wsdToken,
    ])) as NWLOperatorController
    adrs.controller = await controller.getAddress()
    await strategy.setNWLOperatorController(adrs.controller)
    await setupController(controller)

    await strategy.depositEther(8)

    assert.equal(fromEther(await controller.withdrawableStake(0)), 0, 'withdrawableStake incorrect')

    await controller.reportStoppedValidators([0, 4], [1, 2], [0, toEther(6)])

    assert.equal(
      fromEther(await controller.withdrawableStake(0)),
      16,
      'withdrawableStake incorrect'
    )
    assert.equal(
      fromEther(await controller.withdrawableStake(4)),
      26,
      'withdrawableStake incorrect'
    )

    await controller.withdrawStake(0, toEther(10))
    await controller.withdrawStake(4, toEther(26))

    assert.equal(fromEther(await controller.withdrawableStake(0)), 6, 'withdrawableStake incorrect')
    assert.equal(fromEther(await controller.withdrawableStake(4)), 0, 'withdrawableStake incorrect')

    await expect(controller.withdrawStake(0, toEther(7))).to.be.revertedWith(
      'Cannot withdraw more than available'
    )
    await expect(controller.connect(signers[1]).withdrawStake(0, toEther(1))).to.be.revertedWith(
      'Sender is not operator owner'
    )
  })

  it('currentStateHash should be properly updated', async () => {
    const { accounts, controller } = await loadFixture(deployFixture)

    let hash = await controller.currentStateHash()

    await controller.removeKeyPairs(3, 2, [])

    hash = ethers.solidityPackedKeccak256(
      ['bytes32', 'string', 'uint', 'uint', 'uint[]'],
      [hash, 'removeKeyPairs', 3, 2, []]
    )
    assert.equal(hash, await controller.currentStateHash(), 'currentStateHash incorrect')

    await controller.initiateKeyPairValidation(accounts[0], 1)
    await controller.reportKeyPairValidation(1, true)

    hash = ethers.solidityPackedKeccak256(
      ['bytes32', 'string', 'uint'],
      [hash, 'reportKeyPairValidation', 1]
    )
    assert.equal(hash, await controller.currentStateHash(), 'currentStateHash incorrect')

    await controller.assignNextValidators(4)

    for (let i = 0; i < 3; i++) {
      hash = ethers.solidityPackedKeccak256(
        ['bytes32', 'string', 'uint', 'bytes'],
        [
          hash,
          'assignKey',
          0,
          '0x' + keyPairs.keys.slice(i * pubkeyLength + 2, (i + 1) * pubkeyLength + 2),
        ]
      )
    }
    hash = ethers.solidityPackedKeccak256(
      ['bytes32', 'string', 'uint', 'bytes'],
      [hash, 'assignKey', 2, keyPairs.keys.slice(0, pubkeyLength + 2)]
    )
    assert.equal(hash, await controller.currentStateHash(), 'currentStateHash incorrect')
  })
})
