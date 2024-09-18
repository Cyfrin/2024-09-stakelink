import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  deployImplementation,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import {
  ERC677,
  VCSMock,
  StakingMock,
  CommunityVault,
  StakingRewardsMock,
  FundFlowController,
  OperatorVCS,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

function encodeVaults(vaults: number[]) {
  return ethers.AbiCoder.defaultAbiCoder().encode(['uint64[]'], [vaults])
}

function decodeData(data: any) {
  return [
    ethers.AbiCoder.defaultAbiCoder()
      .decode(['uint64[]'], data[0])[0]
      .map((v: any) => Number(v)),
    ethers.AbiCoder.defaultAbiCoder()
      .decode(['uint64[]'], data[1])[0]
      .map((v: any) => Number(v)),
  ]
}

describe('FundFlowController', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    await setupToken(token, accounts)

    const rewardsController = (await deploy('StakingRewardsMock', [
      token.target,
    ])) as StakingRewardsMock
    const stakingController = (await deploy('StakingMock', [
      token.target,
      rewardsController.target,
      toEther(10),
      toEther(100),
      toEther(10000),
      unbondingPeriod,
      claimPeriod,
    ])) as StakingMock

    const vaultDepositController = await deploy('VaultDepositController')

    let opVaultImplementation = await deployImplementation('OperatorVault')

    const opStrategy = (await deployUpgradeable(
      'OperatorVCS',
      [
        token.target,
        accounts[0],
        stakingController.target,
        opVaultImplementation,
        [[accounts[4], 500]],
        10000,
        toEther(100),
        1000,

        vaultDepositController.target,
      ],
      { unsafeAllow: ['delegatecall'] }
    )) as OperatorVCS

    let comVaultImplementation = await deployImplementation('CommunityVault')

    const comStrategy = (await deployUpgradeable(
      'VCSMock',
      [
        token.target,
        accounts[0],
        stakingController.target,
        comVaultImplementation,
        [[accounts[4], 500]],
        toEther(100),
        vaultDepositController.target,
      ],
      { unsafeAllow: ['delegatecall'] }
    )) as VCSMock

    const vaults = []
    const vaultContracts = []
    for (let i = 0; i < 15; i++) {
      let vault = (await deployUpgradeable(
        'CommunityVault',
        [token.target, comStrategy.target, stakingController.target, rewardsController.target],
        { unsafeAllow: ['delegatecall'] }
      )) as CommunityVault
      vaultContracts.push(vault)
      vaults.push(vault.target)
    }

    for (let i = 0; i < 15; i++) {
      await vaultContracts[i].transferOwnership(comStrategy.target)
    }

    await comStrategy.addVaults(vaults)
    await token.approve(comStrategy.target, ethers.MaxUint256)
    await token.approve(opStrategy.target, ethers.MaxUint256)

    const fundFlowController = (await deployUpgradeable('FundFlowController', [
      opStrategy.target,
      comStrategy.target,
      unbondingPeriod,
      claimPeriod,
      5,
    ])) as FundFlowController
    await opStrategy.setFundFlowController(fundFlowController.target)
    await comStrategy.setFundFlowController(fundFlowController.target)

    return {
      accounts,
      token,
      rewardsController,
      stakingController,
      opStrategy,
      comStrategy,
      vaultContracts,
      vaults,
      fundFlowController,
    }
  }

  it('getDepositData should work correctly', async () => {
    const { comStrategy, fundFlowController } = await loadFixture(deployFixture)

    await comStrategy.deposit(toEther(1200), encodeVaults([]))
    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(150))), [[], []])

    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(50), encodeVaults([0, 5]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(270), encodeVaults([1, 6, 11]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(100), encodeVaults([2, 7]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(120), encodeVaults([3, 8]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(200), encodeVaults([4, 9]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(150))), [
      [],
      [0, 1, 6, 11, 4],
    ])
    await comStrategy.deposit(toEther(150), encodeVaults([0, 1, 6, 11, 4]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(200))), [
      [],
      [6, 4, 9, 11, 3, 8, 2],
    ])
    await comStrategy.deposit(toEther(200), encodeVaults([6, 4, 9, 11, 3, 8, 2]))

    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(100), encodeVaults([0, 5]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(50))), [[], [9, 0]])
    await comStrategy.deposit(toEther(50), encodeVaults([9, 0]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(500))), [
      [],
      [9, 0, 5, 3, 8, 2, 11],
    ])
    await comStrategy.deposit(toEther(500), encodeVaults([9, 0, 5, 3, 8, 2, 11]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(500))), [[], []])
  })

  it('getWithdrawalData should work correctly', async () => {
    const { comStrategy, fundFlowController } = await loadFixture(deployFixture)

    await comStrategy.deposit(toEther(1200), encodeVaults([]))
    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(150))), [[], []])

    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(150))), [
      [],
      [0, 5, 10],
    ])
    await comStrategy.withdraw(toEther(150), encodeVaults([0, 5, 10]))
    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(50))), [
      [],
      [5, 10],
    ])
    await comStrategy.deposit(toEther(50), encodeVaults([0]))
    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(50))), [
      [],
      [5, 10],
    ])

    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(400))), [
      [],
      [1, 6, 11],
    ])
    await comStrategy.withdraw(toEther(300), encodeVaults([1, 6, 11]))
    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(400))), [[], []])

    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(50))), [
      [],
      [5, 0],
    ])
    await comStrategy.deposit(toEther(25), encodeVaults([0]))
    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(50))), [
      [],
      [5, 10],
    ])
  })

  it('updateVaultGroups should work correctly', async () => {
    const { comStrategy, fundFlowController } = await loadFixture(deployFixture)

    await comStrategy.deposit(toEther(1200), encodeVaults([]))

    await fundFlowController.updateVaultGroups()
    assert.equal(
      Number(await fundFlowController.timeOfLastUpdateByGroup(0)),
      (await ethers.provider.getBlock('latest'))?.timestamp
    )
    assert.equal(Number(await fundFlowController.curUnbondedVaultGroup()), 1)
    assert.equal(fromEther(await comStrategy.canWithdraw()), 0)
    assert.equal(fromEther((await comStrategy.vaultGroups(0))[1]), 0)
    assert.equal(Number((await comStrategy.globalVaultState())[1]), 1)

    await expect(fundFlowController.updateVaultGroups()).to.be.revertedWithCustomError(
      fundFlowController,
      'NoUpdateNeeded()'
    )

    await time.increase(claimPeriod)

    await fundFlowController.updateVaultGroups()
    assert.equal(
      Number(await fundFlowController.timeOfLastUpdateByGroup(1)),
      (await ethers.provider.getBlock('latest'))?.timestamp
    )
    assert.equal(Number(await fundFlowController.curUnbondedVaultGroup()), 2)
    assert.equal(fromEther(await comStrategy.canWithdraw()), 0)
    assert.equal(fromEther((await comStrategy.vaultGroups(0))[1]), 0)
    assert.equal(Number((await comStrategy.globalVaultState())[1]), 2)

    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod + 10)

    await fundFlowController.updateVaultGroups()
    assert.equal(
      Number(await fundFlowController.timeOfLastUpdateByGroup(4)),
      (await ethers.provider.getBlock('latest'))?.timestamp
    )
    assert.equal(Number(await fundFlowController.curUnbondedVaultGroup()), 0)
    assert.equal(fromEther(await comStrategy.canWithdraw()), 300)
    assert.equal(fromEther((await comStrategy.vaultGroups(0))[1]), 0)
    assert.equal(Number((await comStrategy.globalVaultState())[1]), 0)

    await comStrategy.withdraw(toEther(50), encodeVaults([0, 5]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(270), encodeVaults([1, 6, 11]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(100), encodeVaults([2, 7]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(120), encodeVaults([3, 8]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(200), encodeVaults([4, 9]))
    await time.increase(claimPeriod)

    await comStrategy.deposit(toEther(50), encodeVaults([0, 4]))

    await fundFlowController.updateVaultGroups()
    assert.equal(
      Number(await fundFlowController.timeOfLastUpdateByGroup(4)),
      (await ethers.provider.getBlock('latest'))?.timestamp
    )
    assert.equal(Number(await fundFlowController.curUnbondedVaultGroup()), 0)
    assert.equal(fromEther(await comStrategy.canWithdraw()), 250)
    assert.equal(Number((await comStrategy.globalVaultState())[1]), 0)
    assert.equal(fromEther((await comStrategy.vaultGroups(0))[1]), 50)
    assert.equal(fromEther((await comStrategy.vaultGroups(1))[1]), 270)
    assert.equal(fromEther((await comStrategy.vaultGroups(2))[1]), 100)
    assert.equal(fromEther((await comStrategy.vaultGroups(3))[1]), 120)
    assert.equal(fromEther((await comStrategy.vaultGroups(4))[1]), 150)
  })

  it('updateOperatorVaultGroupAccounting should work correctly', async () => {
    const { accounts, opStrategy, stakingController, fundFlowController } = await loadFixture(
      deployFixture
    )

    for (let i = 0; i < 10; i++) {
      await opStrategy.addVault(accounts[0], accounts[0], accounts[0])
    }
    const vaults = await opStrategy.getVaults()

    await opStrategy.deposit(toEther(1000), encodeVaults([]))

    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    await opStrategy.withdraw(toEther(130), encodeVaults([0, 5]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    assert.equal(fromEther((await opStrategy.vaultGroups(0))[1]), 130)

    await stakingController.removeOperator(vaults[5])
    await opStrategy.queueVaultRemoval(5)

    assert.equal(fromEther(await opStrategy.totalUnbonded()), 200)
    assert.equal(fromEther(await opStrategy.vaultMaxDeposits()), 100)
    assert.equal(fromEther((await opStrategy.vaultGroups(0))[1]), 100)

    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    await stakingController.setDepositLimits(toEther(0), toEther(140))
    await stakingController.slashOperator(vaults[6], toEther(70))
    await stakingController.slashOperator(vaults[2], toEther(30))
    await fundFlowController.updateOperatorVaultGroupAccounting([1, 2])

    assert.equal(fromEther(await opStrategy.totalUnbonded()), 170)
    assert.equal(fromEther(await opStrategy.vaultMaxDeposits()), 140)
    assert.equal(fromEther((await opStrategy.vaultGroups(1))[1]), 150)
    assert.equal(fromEther((await opStrategy.vaultGroups(2))[1]), 110)
  })

  it('should work correctly with 2 strategies', async () => {
    const { comStrategy, fundFlowController, opStrategy, accounts } = await loadFixture(
      deployFixture
    )

    for (let i = 0; i < 10; i++) {
      await opStrategy.addVault(accounts[0], accounts[0], accounts[0])
    }

    await comStrategy.deposit(toEther(1200), encodeVaults([]))
    await opStrategy.deposit(toEther(600), encodeVaults([]))

    assert.deepEqual(decodeData(await fundFlowController.getDepositData(toEther(150))), [[], []])

    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(50), encodeVaults([0, 5]))
    await opStrategy.withdraw(toEther(100), encodeVaults([0, 5]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await comStrategy.withdraw(toEther(270), encodeVaults([1, 6, 11]))
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await opStrategy.withdraw(toEther(50), encodeVaults([2]))

    assert.deepEqual(decodeData(await fundFlowController.getWithdrawalData(toEther(1000))), [
      [2],
      [2, 7],
    ])

    await time.increase(claimPeriod + 10)
    await fundFlowController.updateVaultGroups()
    assert.equal(
      Number(await fundFlowController.timeOfLastUpdateByGroup(2)),
      (await ethers.provider.getBlock('latest'))?.timestamp
    )
    assert.equal(Number(await fundFlowController.curUnbondedVaultGroup()), 3)
    assert.equal(fromEther(await comStrategy.canWithdraw()), 200)
    assert.equal(Number((await comStrategy.globalVaultState())[1]), 3)
    assert.equal(fromEther(await opStrategy.canWithdraw()), 100)
    assert.equal(Number((await opStrategy.globalVaultState())[1]), 3)
  })
})
