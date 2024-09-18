import { ethers, upgrades } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import { ERC677, StrategyMock } from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('Strategy', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()
    await setupToken(token, accounts)

    const strategy = (await deployUpgradeable('StrategyMock', [
      adrs.token,
      accounts[0],
      toEther(1000),
      toEther(10),
    ])) as StrategyMock
    adrs.strategy = await strategy.getAddress()

    await token.approve(adrs.strategy, ethers.MaxUint256)

    return { signers, accounts, adrs, token, strategy }
  }

  it('should be able to upgrade contract, state should persist', async () => {
    const { adrs, token, strategy } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(1000), '0x')

    let StrategyV2 = await ethers.getContractFactory('StrategyMockV2')
    let upgradedImpAddress = (await upgrades.prepareUpgrade(adrs.strategy, StrategyV2, {
      kind: 'uups',
    })) as string
    await strategy.upgradeTo(upgradedImpAddress)

    let upgraded = await ethers.getContractAt('StrategyMockV2', adrs.strategy)
    assert.equal(Number(await upgraded.contractVersion()), 2, 'contract not upgraded')
    assert.equal(fromEther(await upgraded.getTotalDeposits()), 1000, 'state not persisted')
    assert.equal(
      fromEther(await token.balanceOf(await upgraded.getAddress())),
      1000,
      'balance not persisted'
    )
  })

  it('contract should only be upgradeable by owner', async () => {
    const { adrs, signers, strategy } = await loadFixture(deployFixture)

    let StrategyV2 = await ethers.getContractFactory('StrategyMockV2')
    let upgradedImpAddress = (await upgrades.prepareUpgrade(adrs.strategy, StrategyV2, {
      kind: 'uups',
    })) as string

    await expect(strategy.connect(signers[1]).upgradeTo(upgradedImpAddress)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })
})
