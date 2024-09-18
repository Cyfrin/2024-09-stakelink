import { assert, expect } from 'chai'
import { deploy, deployUpgradeable, fromEther, getAccounts, toEther } from '../utils/helpers'
import { ERC677, LSDIndexAdapterMock } from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('LSDIndexAdapter', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const lsd = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Liquid SD Token',
      'LSD',
      100000000,
    ])) as ERC677
    adrs.lsd = await lsd.getAddress()

    const adapter = (await deployUpgradeable('LSDIndexAdapterMock', [
      adrs.lsd,
      accounts[0],
      toEther(2),
    ])) as LSDIndexAdapterMock
    adrs.adapter = await adapter.getAddress()

    await lsd.transfer(adrs.adapter, toEther(1000))

    return { signers, accounts, adrs, lsd, adapter }
  }

  it('getExchangeRate should work correctly', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(fromEther(await adapter.getExchangeRate()), 2)
  })

  it('getLSDByUnderlying should work correctly', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(fromEther(await adapter.getLSDByUnderlying(toEther(100))), 50)
  })

  it('getUnderlyingByLSD should work correctly', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(fromEther(await adapter.getUnderlyingByLSD(toEther(100))), 200)
  })

  it('getTotalDepositsLSD should work correctly', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(fromEther(await adapter.getTotalDepositsLSD()), 1000)
  })

  it('getTotalDeposits should work correctly', async () => {
    const { adapter } = await loadFixture(deployFixture)

    assert.equal(fromEther(await adapter.getTotalDeposits()), 2000)
  })

  it('index pool should be able to withdraw', async () => {
    const { signers, accounts, adrs, adapter, lsd } = await loadFixture(deployFixture)

    await lsd.transferFrom(adrs.adapter, accounts[1], toEther(500))
    assert.equal(fromEther(await adapter.getTotalDepositsLSD()), 500)
    assert.equal(fromEther(await adapter.getTotalDeposits()), 1000)

    await expect(lsd.connect(signers[1]).transferFrom(adrs.adapter, accounts[1], toEther(500))).to
      .be.reverted
  })
})
