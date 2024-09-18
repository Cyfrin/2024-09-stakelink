import { assert, expect } from 'chai'
import {
  padBytes,
  concatBytes,
  getAccounts,
  deployUpgradeable,
  deploy,
  toEther,
  fromEther,
} from '../utils/helpers'
import {
  ERC677,
  OperatorControllerMock,
  OperatorControllerMockV2,
  RewardsPool,
} from '../../typechain-types'
import { ethers, upgrades } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const pubkeyLength = 48 * 2
const signatureLength = 96 * 2

const keyPairs = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48), padBytes('0xa3', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96), padBytes('0xb3', 96)]),
}

describe('OperatorController', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
    const adrs: any = {}

    const sdToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'test',
      'test',
      50,
    ])) as ERC677
    adrs.sdToken = await sdToken.getAddress()

    const controller = (await deployUpgradeable('OperatorControllerMock', [
      accounts[0],
      adrs.sdToken,
    ])) as OperatorControllerMock
    adrs.controller = await controller.getAddress()

    const rewardsPool = (await deploy('RewardsPool', [
      adrs.controller,
      adrs.sdToken,
    ])) as RewardsPool
    adrs.rewardsPool = await rewardsPool.getAddress()

    await controller.setRewardsPool(adrs.rewardsPool)
    await controller.setKeyValidationOracle(accounts[0])
    await controller.setBeaconOracle(accounts[0])

    for (let i = 0; i < 5; i++) {
      await controller.addOperator('test')
      await controller.addKeyPairs(i, 3, keyPairs.keys, keyPairs.signatures)
      if (i % 2 == 0) {
        await controller.initiateKeyPairValidation(accounts[0], i)
        await controller.reportKeyPairValidation(i, true)
      }
    }

    return { signers, accounts, adrs, sdToken, controller, rewardsPool }
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

  it('addKeyPairs and getKeyPairs should work correctly', async () => {
    const { accounts, controller } = await loadFixture(deployFixture)

    await controller.addOperator('Testing123')
    await controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures)
    let op = (await controller.getOperators([5]))[0]

    assert.equal(Number(op[4]), 0, 'operator validatorLimit incorrect')
    assert.equal(Number(op[6]), 3, 'operator totalKeyPairs incorrect')
    assert.equal(Number(op[7]), 0, 'operator usedKeyPairs incorrect')

    let pairs = await controller.getKeyPairs(5, 0, 2)
    assert.equal(pairs[0], keyPairs.keys.slice(0, 2 * pubkeyLength + 2))
    assert.equal(pairs[1], keyPairs.signatures.slice(0, 2 * signatureLength + 2))

    pairs = await controller.getKeyPairs(5, 0, 10)
    assert.equal(pairs[0], keyPairs.keys)
    assert.equal(pairs[1], keyPairs.signatures)

    pairs = await controller.getKeyPairs(5, 1, 2)
    assert.equal(pairs[0], '0x' + keyPairs.keys.slice(pubkeyLength + 2))
    assert.equal(pairs[1], '0x' + keyPairs.signatures.slice(signatureLength + 2))

    await expect(controller.getKeyPairs(6, 0, 2)).to.be.revertedWith('Operator does not exist')
    await expect(controller.getKeyPairs(0, 4, 1)).to.be.revertedWith('startIndex out of range')
    await expect(
      controller.addKeyPairs(5, 3, keyPairs.keys.slice(0, 50), keyPairs.signatures)
    ).to.be.revertedWith('Invalid pubkeys length')
    await expect(
      controller.addKeyPairs(5, 3, keyPairs.keys, keyPairs.signatures.slice(0, 50))
    ).to.be.revertedWith('Invalid signatures length')
  })

  it('initiateKeyPairValidation should work correctly', async () => {
    const { accounts, controller } = await loadFixture(deployFixture)

    await expect(controller.initiateKeyPairValidation(accounts[1], 3)).to.be.revertedWith(
      'Sender is not operator owner'
    )

    await controller.initiateKeyPairValidation(accounts[0], 3)

    let op = (await controller.getOperators([3]))[0]
    assert.equal(op[3], true, 'operator keyValidationInProgress incorrect')

    await expect(
      controller.addKeyPairs(3, 3, keyPairs.keys, keyPairs.signatures)
    ).to.be.revertedWith('Key validation in progress')
  })

  it('rewards distribution should work correctly', async () => {
    const { signers, accounts, adrs, controller, sdToken } = await loadFixture(deployFixture)

    await controller.assignNextValidators([0], [1], 1)
    await sdToken.transferAndCall(adrs.controller, toEther(50), '0x00')

    assert.equal(
      fromEther(await sdToken.balanceOf(adrs.rewardsPool)),
      50,
      'rewards pool balance incorrect'
    )
    assert.equal(
      fromEther(await controller.withdrawableRewards(accounts[0])),
      50,
      'account rewards balance incorrect'
    )
    assert.equal(
      fromEther(await controller.withdrawableRewards(accounts[1])),
      0,
      'account rewards balance incorrect'
    )

    await controller.connect(signers[1]).withdrawRewards()
    await controller.withdrawRewards()

    assert.equal(
      fromEther(await sdToken.balanceOf(accounts[0])),
      50,
      'account sdToken balance incorrect'
    )

    await expect(controller.onTokenTransfer(accounts[0], 10, '0x00')).to.be.revertedWith(
      'Sender is not sdToken'
    )
  })

  it('getAssignedKeys should work correctly', async () => {
    const { controller } = await loadFixture(deployFixture)

    await controller.assignNextValidators([0, 2, 4], [3, 2, 1], 6)

    let keys = await controller.getAssignedKeys(0, 100)
    assert.equal(
      keys,
      keyPairs.keys +
        keyPairs.keys.slice(2, 2 * pubkeyLength + 2) +
        keyPairs.keys.slice(2, pubkeyLength + 2),
      'keys incorrect'
    )

    keys = await controller.getAssignedKeys(0, 4)
    assert.equal(keys, keyPairs.keys + keyPairs.keys.slice(2, pubkeyLength + 2), 'keys incorrect')

    keys = await controller.getAssignedKeys(2, 3)
    assert.equal(
      keys,
      '0x' + keyPairs.keys.slice(-pubkeyLength) + keyPairs.keys.slice(2, 2 * pubkeyLength + 2),
      'keys incorrect'
    )

    await expect(controller.getAssignedKeys(10, 1)).to.be.revertedWith('startIndex out of range')
  })

  it('currentStateHash should be properly updated', async () => {
    const { accounts, controller } = await loadFixture(deployFixture)

    let hash = await controller.currentStateHash()

    await controller.addKeyPairs(3, 3, keyPairs.keys, keyPairs.signatures)
    await controller.initiateKeyPairValidation(accounts[0], 3)
    await controller.reportKeyPairValidation(3, true)
    for (let i = 0; i < 3; i++) {
      hash = ethers.solidityPackedKeccak256(
        ['bytes32', 'string', 'uint', 'bytes'],
        [
          hash,
          'addKey',
          3,
          '0x' + keyPairs.keys.slice(i * pubkeyLength + 2, (i + 1) * pubkeyLength + 2),
        ]
      )
    }
    assert.equal(hash, await controller.currentStateHash(), 'currentStateHash incorrect')

    await controller.disableOperator(3)

    hash = ethers.solidityPackedKeccak256(
      ['bytes32', 'string', 'uint'],
      [hash, 'disableOperator', 3]
    )
    assert.equal(hash, await controller.currentStateHash(), 'currentStateHash incorrect')
  })

  it('setOperatorName should work correctly', async () => {
    const { signers, controller } = await loadFixture(deployFixture)

    await controller.setOperatorName(0, '1234')

    let op = (await controller.getOperators([0]))[0]
    assert.equal(op[0], '1234', 'operator name incorrect')

    await expect(controller.setOperatorName(5, '123')).to.be.revertedWith('Operator does not exist')
    await expect(controller.connect(signers[1]).setOperatorName(0, '123')).to.be.revertedWith(
      'Sender is not operator owner'
    )
  })

  it('setOperatorOwner should work correctly', async () => {
    const { signers, accounts, controller } = await loadFixture(deployFixture)

    await controller.assignNextValidators([0, 2, 4], [3, 2, 2], 7)
    await controller.setOperatorOwner(0, accounts[2])

    let op = (await controller.getOperators([0]))[0]
    assert.equal(op[1], accounts[2], 'operator owner incorrect')

    assert.equal(Number(await controller.staked(accounts[0])), 4, 'operator staked incorrect')
    assert.equal(Number(await controller.staked(accounts[2])), 3, 'operator staked incorrect')

    await expect(controller.setOperatorOwner(5, accounts[1])).to.be.revertedWith(
      'Operator does not exist'
    )
    await expect(
      controller.connect(signers[1]).setOperatorOwner(0, accounts[1])
    ).to.be.revertedWith('Sender is not operator owner')
    await expect(controller.setOperatorOwner(1, ethers.ZeroAddress)).to.be.revertedWith(
      'Owner address cannot be 0'
    )
  })

  it('disableOperator should work correctly', async () => {
    const { signers, controller } = await loadFixture(deployFixture)

    await controller.disableOperator(0)

    let op = (await controller.getOperators([0]))[0]
    assert.equal(op[2], false, 'operator active incorrect')

    await expect(controller.connect(signers[1]).disableOperator(2)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('setKeyValidationOracle should work correctly', async () => {
    const { signers, accounts, controller } = await loadFixture(deployFixture)

    await controller.setKeyValidationOracle(accounts[1])

    assert.equal(
      await controller.keyValidationOracle(),
      accounts[1],
      'keyValidationOracle incorrect'
    )

    await expect(
      controller.connect(signers[1]).setKeyValidationOracle(accounts[2])
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('setBeaconOracle should work correctly', async () => {
    const { signers, accounts, controller } = await loadFixture(deployFixture)

    await controller.setBeaconOracle(accounts[1])

    assert.equal(await controller.beaconOracle(), accounts[1], 'beaconOracle incorrect')

    await expect(controller.connect(signers[1]).setBeaconOracle(accounts[2])).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('contract upgradeability should work correctly', async () => {
    const { signers, accounts, adrs, controller } = await loadFixture(deployFixture)

    await controller.assignNextValidators([0], [2], 2)

    let Controller = await ethers.getContractFactory('OperatorControllerMockV2')
    let upgradedImpAddress = (await upgrades.prepareUpgrade(adrs.controller, Controller, {
      kind: 'uups',
    })) as string

    await expect(controller.connect(signers[1]).upgradeTo(upgradedImpAddress)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )

    await controller.upgradeTo(upgradedImpAddress)

    let upgraded = (await ethers.getContractAt(
      'OperatorControllerMockV2',
      adrs.controller
    )) as OperatorControllerMockV2
    assert.equal(Number(await upgraded.contractVersion()), 2, 'contract not upgraded')

    let op = (await controller.getOperators([0]))[0]
    assert.equal(op[0], 'test', 'operator name incorrect')
    assert.equal(op[1], accounts[0], 'operator owner incorrect')
    assert.equal(op[2], true, 'operator active incorrect')
    assert.equal(op[3], false, 'operator keyValidationInProgress incorrect')
    assert.equal(Number(op[4]), 3, 'operator validatorLimit incorrect')
    assert.equal(Number(op[5]), 0, 'operator stoppedValidators incorrect')
    assert.equal(Number(op[6]), 3, 'operator totalKeyPairs incorrect')
    assert.equal(Number(op[7]), 2, 'operator usedKeyPairs incorrect')

    assert.equal(
      Number(await upgraded.totalActiveValidators()),
      2,
      'totalActiveValidator incorrect'
    )
    assert.equal(Number(await upgraded.staked(accounts[0])), 2, 'operator staked incorrect')
  })
})
