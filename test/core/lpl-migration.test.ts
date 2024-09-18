import { toEther, deploy, getAccounts, setupToken, fromEther } from '../utils/helpers'
import { ERC677, StakingAllowance, LPLMigration } from '../../typechain-types'
import { assert, expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'

describe('LPLMigration', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const lplToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'LinkPool',
      'LPL',
      100000000,
    ])) as ERC677
    adrs.lplToken = await lplToken.getAddress()
    await setupToken(lplToken, accounts)

    const sdlToken = (await deploy('StakingAllowance', [
      'Stake Dot Link',
      'SDL',
    ])) as StakingAllowance
    adrs.sdlToken = await sdlToken.getAddress()

    const lplMigration = (await deploy('LPLMigration', [
      adrs.lplToken,
      adrs.sdlToken,
    ])) as LPLMigration
    adrs.lplMigration = await lplMigration.getAddress()

    await sdlToken.mint(accounts[0], toEther(50000000))
    await sdlToken.transfer(adrs.lplMigration, toEther(50000000))
    await lplToken.connect(signers[1]).transferAndCall(adrs.lplMigration, toEther(10000), '0x')
    await lplToken.connect(signers[2]).transferAndCall(adrs.lplMigration, toEther(100), '0x')

    return { signers, accounts, adrs, lplToken, sdlToken, lplMigration }
  }

  it('should be able to swap LPL for SDL', async () => {
    const { accounts, lplToken, sdlToken } = await loadFixture(deployFixture)

    assert.equal(
      fromEther(await lplToken.balanceOf(accounts[1])),
      0,
      'Account-1 LPL balance should be 0'
    )
    assert.equal(
      fromEther(await sdlToken.balanceOf(accounts[1])),
      5000,
      'Account-1 SDL balance should be 5000'
    )
    assert.equal(
      fromEther(await lplToken.balanceOf(accounts[2])),
      9900,
      'Account-2 LPL balance should be 9900'
    )
    assert.equal(
      fromEther(await sdlToken.balanceOf(accounts[2])),
      50,
      'Account-2 SDL balance should be 50'
    )
  })

  it('should be correct amount of LPL and SDL in contract', async () => {
    const { adrs, lplToken, sdlToken } = await loadFixture(deployFixture)

    assert.equal(
      fromEther(await lplToken.balanceOf(adrs.lplMigration)),
      10100,
      'Should be 10100 LPL locked in migration contract'
    )
    assert.equal(
      fromEther(await sdlToken.balanceOf(adrs.lplMigration)),
      49994950,
      'Should be 4994950 SDL left in migration contract'
    )
  })

  it('should not be able to swap more than LPL balance', async () => {
    const { adrs, signers, lplToken } = await loadFixture(deployFixture)

    await expect(
      lplToken.connect(signers[2]).transferAndCall(adrs.lplMigration, toEther(10000), '0x')
    ).to.be.revertedWith('ERC20: transfer amount exceeds balance')
  })

  it('onTokenTransfer should only be callable by LPL token', async () => {
    const { accounts, lplMigration } = await loadFixture(deployFixture)

    await expect(lplMigration.onTokenTransfer(accounts[0], toEther(1000), '0x')).to.be.revertedWith(
      'Sender must be LPL token'
    )
  })
})
