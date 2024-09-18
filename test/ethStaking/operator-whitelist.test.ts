import { assert, expect } from 'chai'
import { deploy, getAccounts } from '../utils/helpers'
import { OperatorWhitelist } from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('OperatorWhitelist', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const opWhitelist = (await deploy('OperatorWhitelist', [
      accounts[0],
      accounts.slice(2),
    ])) as OperatorWhitelist
    adrs.opWhitelist = await opWhitelist.getAddress()

    return { signers, accounts, adrs, opWhitelist }
  }

  it('getWhitelistEntry should work correctly', async () => {
    const { accounts, opWhitelist } = await loadFixture(deployFixture)

    assert.deepEqual(await opWhitelist.getWhitelistEntry(accounts[0]), [false, false])
    assert.deepEqual(await opWhitelist.getWhitelistEntry(accounts[2]), [true, false])
  })

  it('useWhitelist should work correctly', async () => {
    const { signers, accounts, opWhitelist } = await loadFixture(deployFixture)

    await opWhitelist.useWhitelist(accounts[3])

    assert.deepEqual(await opWhitelist.getWhitelistEntry(accounts[3]), [true, true])

    await expect(opWhitelist.connect(signers[1]).useWhitelist(accounts[2])).to.be.revertedWith(
      'Sender is not wl operator controller'
    )
    await expect(opWhitelist.useWhitelist(accounts[1])).to.be.revertedWith(
      'Account is not whitelisted'
    )
    await expect(opWhitelist.useWhitelist(accounts[3])).to.be.revertedWith(
      'Account whitelist spot already used'
    )
  })

  it('addWhitelistEntries should work correctly', async () => {
    const { signers, accounts, opWhitelist } = await loadFixture(deployFixture)

    await expect(opWhitelist.addWhitelistEntries([accounts[2]])).to.be.revertedWith(
      'Account already whitelisted'
    )
    await expect(
      opWhitelist.connect(signers[1]).addWhitelistEntries([accounts[0]])
    ).to.be.revertedWith('Ownable: caller is not the owner')

    await opWhitelist.addWhitelistEntries(accounts.slice(0, 2))

    assert.deepEqual(await opWhitelist.getWhitelistEntry(accounts[0]), [true, false])
    assert.deepEqual(await opWhitelist.getWhitelistEntry(accounts[1]), [true, false])
  })

  it('removeWhitelistEntries should work correctly', async () => {
    const { signers, accounts, opWhitelist } = await loadFixture(deployFixture)

    await expect(opWhitelist.removeWhitelistEntries([accounts[0]])).to.be.revertedWith(
      'Account is not whitelisted'
    )
    await expect(
      opWhitelist.connect(signers[1]).removeWhitelistEntries([accounts[2]])
    ).to.be.revertedWith('Ownable: caller is not the owner')

    await opWhitelist.removeWhitelistEntries(accounts.slice(2, 4))

    assert.deepEqual(await opWhitelist.getWhitelistEntry(accounts[2]), [false, false])
    assert.deepEqual(await opWhitelist.getWhitelistEntry(accounts[3]), [false, false])
  })

  it('setWLOperatorController should work correctly', async () => {
    const { signers, accounts, opWhitelist } = await loadFixture(deployFixture)

    await opWhitelist.setWLOperatorController(accounts[2])

    assert.equal(await opWhitelist.wlOperatorController(), accounts[2])

    await expect(
      opWhitelist.connect(signers[1]).setWLOperatorController(accounts[3])
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })
})
