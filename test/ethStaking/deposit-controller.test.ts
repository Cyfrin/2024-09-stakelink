import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  padBytes,
  concatBytes,
} from '../utils/helpers'
import {
  StakingPool,
  WrappedSDToken,
  EthStakingStrategy,
  WrappedETH,
  DepositContract,
  WLOperatorController,
  NWLOperatorController,
  OperatorWhitelistMock,
  RewardsPool,
  DepositController,
} from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const pubkeyLength = 48 * 2

const nwlOps = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96)]),
}

const wlOps = {
  keys: concatBytes([padBytes('0xc1', 48), padBytes('0xc2', 48), padBytes('0xc3', 48)]),
  signatures: concatBytes([padBytes('0xd1', 96), padBytes('0xd2', 96), padBytes('0xd3', 96)]),
}

const withdrawalCredentials = padBytes('0x12345', 32)

describe('DepositController', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const wETH = (await deploy('WrappedETH')) as WrappedETH
    adrs.wETH = await wETH.getAddress()

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.wETH,
      'LinkPool ETH',
      'lplETH',
      [],
      toEther(10000),
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    const wsdToken = (await deploy('WrappedSDToken', [
      adrs.stakingPool,
      'Wrapped LinkPool ETH',
      'wlplETH',
    ])) as WrappedSDToken
    adrs.wsdToken = await wsdToken.getAddress()

    const depositContract = (await deploy('DepositContract')) as DepositContract
    adrs.depositContract = await depositContract.getAddress()

    const strategy = (await deployUpgradeable('EthStakingStrategy', [
      adrs.wETH,
      adrs.stakingPool,
      toEther(1000),
      toEther(10),
      adrs.depositContract,
      withdrawalCredentials,
      1000,
    ])) as EthStakingStrategy
    adrs.strategy = await strategy.getAddress()

    await strategy.setBeaconOracle(accounts[0])

    const nwlOperatorController = (await deployUpgradeable('NWLOperatorController', [
      adrs.strategy,
      adrs.wsdToken,
    ])) as NWLOperatorController
    adrs.nwlOperatorController = await nwlOperatorController.getAddress()

    await nwlOperatorController.setKeyValidationOracle(accounts[0])
    await nwlOperatorController.setBeaconOracle(accounts[0])

    let operatorWhitelist = (await deploy('OperatorWhitelistMock', [
      [accounts[0]],
    ])) as OperatorWhitelistMock
    const wlOperatorController = (await deployUpgradeable('WLOperatorController', [
      adrs.strategy,
      adrs.wsdToken,
      await operatorWhitelist.getAddress(),
      2,
    ])) as WLOperatorController
    adrs.wlOperatorController = await wlOperatorController.getAddress()

    await wlOperatorController.setKeyValidationOracle(accounts[0])
    await wlOperatorController.setBeaconOracle(accounts[0])

    const nwlRewardsPool = (await deploy('RewardsPool', [
      adrs.nwlOperatorController,
      adrs.wsdToken,
    ])) as RewardsPool
    adrs.nwlRewardsPool = await nwlRewardsPool.getAddress()

    const wlRewardsPool = (await deploy('RewardsPool', [
      adrs.wlOperatorController,
      adrs.wsdToken,
    ])) as RewardsPool
    adrs.wlRewardsPool = await wlRewardsPool.getAddress()

    await nwlOperatorController.setRewardsPool(adrs.nwlRewardsPool)
    await wlOperatorController.setRewardsPool(adrs.wlRewardsPool)

    for (let i = 0; i < 5; i++) {
      await nwlOperatorController.addOperator('test')
      await nwlOperatorController.addKeyPairs(i, 2, nwlOps.keys, nwlOps.signatures, {
        value: toEther(16 * 2),
      })
      await wlOperatorController.addOperator('test')
      await wlOperatorController.addKeyPairs(i, 3, wlOps.keys, wlOps.signatures)

      if (i % 3 == 0) {
        await nwlOperatorController.initiateKeyPairValidation(accounts[0], i)
        await nwlOperatorController.reportKeyPairValidation(i, true)
        await wlOperatorController.initiateKeyPairValidation(accounts[0], i)
        await wlOperatorController.reportKeyPairValidation(i, true)
      }
    }

    const depositController = (await deploy('DepositController', [
      adrs.depositContract,
      adrs.strategy,
      adrs.nwlOperatorController,
      adrs.wlOperatorController,
    ])) as DepositController
    adrs.depositController = await depositController.getAddress()

    await strategy.setNWLOperatorController(adrs.nwlOperatorController)
    await strategy.setWLOperatorController(adrs.wlOperatorController)
    await strategy.setDepositController(adrs.depositController)
    await stakingPool.addStrategy(adrs.strategy)
    await stakingPool.setPriorityPool(accounts[0])
    await wETH.approve(adrs.stakingPool, ethers.MaxUint256)

    return {
      signers,
      accounts,
      adrs,
      wETH,
      stakingPool,
      wsdToken,
      depositContract,
      strategy,
      nwlOperatorController,
      wlOperatorController,
      nwlRewardsPool,
      wlRewardsPool,
      depositController,
    }
  }

  it('getNextValidators should work correctly', async () => {
    const { depositController, nwlOperatorController, wlOperatorController, depositContract } =
      await loadFixture(deployFixture)

    let [
      depositRoot,
      nwlStateHash,
      wlStateHash,
      nwlTotalValidatorCount,
      wlTotalValidatorCount,
      wlOperatorIds,
      wlValidatorCounts,
      nwlKeys,
      wlKeys,
    ] = await depositController.getNextValidators(7)

    assert.equal(depositRoot, await depositContract.get_deposit_root(), 'depositRoot incorrect')
    assert.equal(
      nwlStateHash,
      await nwlOperatorController.currentStateHash(),
      'nwlStateHash incorrect'
    )
    assert.equal(
      wlStateHash,
      await wlOperatorController.currentStateHash(),
      'wlStateHash incorrect'
    )
    assert.equal(Number(nwlTotalValidatorCount), 4, 'nwlTotalValidatorCount incorrect')
    assert.equal(Number(wlTotalValidatorCount), 2, 'wlTotalValidatorCount incorrect')
    assert.deepEqual(
      wlOperatorIds.map((id) => Number(id)),
      [0],
      'wlOperatorIds incorrect'
    )
    assert.deepEqual(
      wlValidatorCounts.map((count) => Number(count)),
      [2],
      'wlValidatorCounts incorrect'
    )
    assert.equal(nwlKeys, nwlOps.keys + nwlOps.keys.slice(2), 'nwlKeys incorrect')
    assert.equal(wlKeys, wlOps.keys.slice(0, 2 * pubkeyLength + 2), 'wlKeys incorrect')
  })

  // it('depositEther should work correctly', async () => {
  //   const {
  //     signers,
  //     accounts,
  //     depositController,
  //     nwlOperatorController,
  //     wlOperatorController,
  //     depositContract,
  //     wETH,
  //     stakingPool,
  //   } = await loadFixture(deployFixture)

  //   type DepositData = [string, string, string, number, number, number[], number[]]
  //   await wETH.wrap({ value: toEther(1000) })
  //   await stakingPool.deposit(accounts[0], toEther(1000), ['0x'])

  //   let depositData = (await depositController.getNextValidators(1)).slice(0, -2) as DepositData
  //   await expect(
  //     depositController.connect(signers[1]).depositEther(...depositData)
  //   ).to.be.revertedWith('Ownable: caller is not the owner')

  //   console.log(depositData)

  //   await depositController.depositEther(...depositData)
  //   await expect(depositController.depositEther(...depositData)).to.be.revertedWith(
  //     'depositRoot has changed'
  //   )

  //   depositData = (await depositController.getNextValidators(7)).slice(0, -2) as DepositData
  //   await nwlOperatorController.addKeyPairs(0, 2, nwlOps.keys, nwlOps.signatures, {
  //     value: toEther(16 * 2),
  //   })
  //   console.log(depositData)
  //   await expect(depositController.depositEther(...depositData)).to.be.revertedWith(
  //     'nwlStateHash has changed'
  //   )

  //   depositData = (await depositController.getNextValidators(7)).slice(0, -2) as DepositData
  //   await wlOperatorController.addKeyPairs(0, 3, wlOps.keys, wlOps.signatures)
  //   await expect(depositController.depositEther(...depositData)).to.be.revertedWith(
  //     'wlStateHash has changed'
  //   )

  //   depositData = (await depositController.getNextValidators(7)).slice(0, -2) as DepositData
  //   await depositController.depositEther(...depositData)

  //   assert.equal(await depositContract.get_deposit_count(), '0x0800000000000000')
  // })
})
