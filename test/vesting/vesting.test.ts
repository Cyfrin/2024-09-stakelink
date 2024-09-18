import { toEther, deploy, getAccounts, fromEther } from '../utils/helpers'
import { StakingAllowance, Vesting } from '../../typechain-types'
import { assert } from 'chai'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import { ethers } from 'hardhat'

describe('Vesting', () => {
  async function deployFixture() {
    const { accounts } = await getAccounts()
    const adrs: any = {}

    const sdlToken = (await deploy('StakingAllowance', [
      'Stake Dot Link',
      'SDL',
    ])) as StakingAllowance
    adrs.sdlToken = await sdlToken.getAddress()

    const start: any = (await ethers.provider.getBlock('latest'))?.timestamp
    adrs.sdlToken = await sdlToken.getAddress()

    const vesting = (await deploy('Vesting', [
      accounts[0],
      accounts[1],
      start,
      86400 * 10,
    ])) as Vesting
    adrs.vesting = await vesting.getAddress()

    await sdlToken.mint(accounts[0], toEther(1000))
    await sdlToken.transfer(adrs.vesting, toEther(1000))

    return { accounts, adrs, sdlToken, start, vesting }
  }

  it('vars should be correctly set', async () => {
    const { accounts, start, vesting } = await loadFixture(deployFixture)

    assert.equal(await vesting.owner(), accounts[0])
    assert.equal(await vesting.beneficiary(), accounts[1])
    assert.equal(Number(await vesting.start()), start)
    assert.equal(Number(await vesting.duration()), 86400 * 10)
  })

  it('should be able to terminate vesting', async () => {
    const { accounts, adrs, start, vesting, sdlToken } = await loadFixture(deployFixture)

    await time.setNextBlockTimestamp(start + 4 * 86400)
    await vesting.terminateVesting([adrs.sdlToken])
    await vesting.releaseRemaining(adrs.sdlToken)

    assert.equal(fromEther(await sdlToken.balanceOf(accounts[0])), 600)
    assert.equal(fromEther(await sdlToken.balanceOf(accounts[1])), 400)
    assert.equal(fromEther(await sdlToken.balanceOf(adrs.vesting)), 0)
  })
})
