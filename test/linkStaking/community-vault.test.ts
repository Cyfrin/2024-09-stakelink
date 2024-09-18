import { ethers } from 'hardhat'
import { assert } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../utils/helpers'
import { ERC677, CommunityVault, StakingMock, StakingRewardsMock } from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('CommunityVault', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()

    const rewardsController = (await deploy('StakingRewardsMock', [
      adrs.token,
    ])) as StakingRewardsMock
    adrs.rewardsController = await rewardsController.getAddress()

    const stakingController = (await deploy('StakingMock', [
      adrs.token,
      adrs.rewardsController,
      toEther(10),
      toEther(100),
      toEther(10000),
      28 * 86400,
      7 * 86400,
    ])) as StakingMock
    adrs.stakingController = await stakingController.getAddress()

    const vault = (await deployUpgradeable('CommunityVault', [
      adrs.token,
      accounts[1],
      adrs.stakingController,
      adrs.rewardsController,
    ])) as CommunityVault
    adrs.vault = await vault.getAddress()

    await token.connect(signers[1]).approve(adrs.vault, ethers.MaxUint256)
    await token.transfer(adrs.rewardsController, toEther(10000))
    await token.transfer(accounts[1], toEther(100))

    return { signers, accounts, adrs, token, rewardsController, stakingController, vault }
  }

  it('claimRewards should work correctly', async () => {
    const { signers, accounts, adrs, vault, rewardsController, token } = await loadFixture(
      deployFixture
    )

    await vault.connect(signers[1]).deposit(toEther(100))
    await vault.connect(signers[1]).claimRewards(0, accounts[5])
    await rewardsController.setReward(adrs.vault, toEther(10))
    await vault.connect(signers[1]).claimRewards(toEther(11), accounts[5])
    assert.equal(fromEther(await vault.getRewards()), 10)
    assert.equal(fromEther(await token.balanceOf(accounts[5])), 0)

    await vault.connect(signers[1]).claimRewards(toEther(10), accounts[5])
    assert.equal(fromEther(await vault.getRewards()), 0)
    assert.equal(fromEther(await token.balanceOf(accounts[5])), 10)
  })
})
