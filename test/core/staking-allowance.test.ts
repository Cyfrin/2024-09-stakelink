import { deploy, fromEther, getAccounts, toEther } from '../utils/helpers'
import { StakingAllowance } from '../../typechain-types'
import { assert, expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('StakingAllowance', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('StakingAllowance', [
      'Staking Allowance',
      'STA',
    ])) as StakingAllowance
    adrs.token = await token.getAddress()

    await token.mint(accounts[0], toEther(10000))

    return { signers, accounts, adrs, token }
  }

  it('should be able to burn tokens', async () => {
    const { accounts, token } = await loadFixture(deployFixture)

    await token.burn(toEther(1000))

    let balance = await token.balanceOf(accounts[0])
    assert.equal(fromEther(balance), 9000, 'balance does not match')
  })

  it('should be able to burn tokens from address', async () => {
    const { signers, accounts, token } = await loadFixture(deployFixture)

    await token.approve(accounts[1], toEther(1000))
    await token.connect(signers[1]).burnFrom(accounts[0], toEther(1000))

    let balance = await token.balanceOf(accounts[0])
    assert.equal(fromEther(balance), 9000, 'balance does not match')
  })

  it('should not be able to burn tokens that exceed allowance', async () => {
    const { signers, accounts, token } = await loadFixture(deployFixture)

    await token.approve(accounts[1], toEther(1000))
    await expect(token.connect(signers[1]).burnFrom(accounts[0], toEther(1001))).to.be.revertedWith(
      'ERC20: insufficient allowance'
    )
  })

  it('should not be able to mint tokens from non-owner', async () => {
    const { signers, accounts, token } = await loadFixture(deployFixture)

    await expect(token.connect(signers[1]).mint(accounts[0], toEther(10000))).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })
})
