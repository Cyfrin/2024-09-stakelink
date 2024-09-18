import { assert, expect } from 'chai'
import { ethers } from 'hardhat'
import {
  deploy,
  deployUpgradeable,
  getAccounts,
  toEther,
  fromEther,
  concatBytes,
  padBytes,
} from '../utils/helpers'
import { ERC677, KeyValidationOracle, OperatorControllerMock } from '../../typechain-types'
import { Signer } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const keyPairs = {
  keys: concatBytes([padBytes('0xa1', 48), padBytes('0xa2', 48), padBytes('0xa3', 48)]),
  signatures: concatBytes([padBytes('0xb1', 96), padBytes('0xb2', 96), padBytes('0xb3', 96)]),
}

describe('KeyValidationOracle', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()

    let wsdToken = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'test',
      'test',
      0,
    ])) as ERC677

    const nwlOpController = (await deployUpgradeable('OperatorControllerMock', [
      accounts[0],
      await wsdToken.getAddress(),
    ])) as OperatorControllerMock
    adrs.nwlOpController = await nwlOpController.getAddress()

    const wlOpController = (await deployUpgradeable('OperatorControllerMock', [
      accounts[0],
      await wsdToken.getAddress(),
    ])) as OperatorControllerMock
    adrs.wlOpController = await wlOpController.getAddress()

    const kvOracle = (await deploy('KeyValidationOracle', [
      adrs.nwlOpController,
      adrs.wlOpController,
      adrs.token,
      accounts[0],
      '0x0000000000000000000000000000000053f9755920cd451a8fe46f5087468395',
      toEther(5),
    ])) as KeyValidationOracle
    adrs.kvOracle = await kvOracle.getAddress()

    await nwlOpController.setKeyValidationOracle(adrs.kvOracle)
    await wlOpController.setKeyValidationOracle(adrs.kvOracle)

    await nwlOpController.addOperator('test')
    await wlOpController.addOperator('test')

    await nwlOpController.addKeyPairs(0, 3, keyPairs.keys, keyPairs.signatures)
    await wlOpController.addKeyPairs(0, 3, keyPairs.keys, keyPairs.signatures)

    return { signers, accounts, adrs, token, nwlOpController, wlOpController, kvOracle }
  }

  it('setOracleConfig should work correctly', async () => {
    const { signers, accounts, kvOracle } = await loadFixture(deployFixture)

    await kvOracle.setOracleConfig(
      accounts[3],
      '0x0000000000000000000000000000000093f9755920cd451a8fe46f5087468395',
      toEther(23)
    )

    assert.equal(await kvOracle.oracleAddress(), accounts[3], 'oracleAddress incorrect')
    assert.equal(
      await kvOracle.jobId(),
      '0x0000000000000000000000000000000093f9755920cd451a8fe46f5087468395',
      'jobId incorrect'
    )
    assert.equal(fromEther(await kvOracle.fee()), 23, 'fee incorrect')

    await expect(
      kvOracle
        .connect(signers[2])
        .setOracleConfig(
          accounts[3],
          '0x0000000000000000000000000000000093f9755920cd451a8fe46f5087468395',
          toEther(23)
        )
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('should be able be able initiate validation', async () => {
    const { adrs, accounts, kvOracle, token, nwlOpController, wlOpController } = await loadFixture(
      deployFixture
    )

    await expect(kvOracle.onTokenTransfer(accounts[3], toEther(10), '0x00')).to.be.revertedWith(
      'Sender is not chainlink token'
    )
    await expect(token.transferAndCall(adrs.kvOracle, toEther(10), '0x00')).to.be.revertedWith(
      'Value is not equal to fee'
    )

    await token.transferAndCall(
      adrs.kvOracle,
      toEther(5),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bool'], [0, false])
    )
    assert.equal((await nwlOpController.getOperators([0]))[0][3], true)

    await token.transferAndCall(
      adrs.kvOracle,
      toEther(5),
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bool'], [0, true])
    )
    assert.equal((await wlOpController.getOperators([0]))[0][3], true)
  })

  // it('should be able be able report validation results', async () => {
  //   const { signers, adrs, kvOracle, token, nwlOpController, wlOpController } = await loadFixture(
  //     deployFixture
  //   )

  //   let tx = await token.transferAndCall(
  //     adrs.kvOracle,
  //     toEther(5),
  //     ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bool'], [0, false])
  //   )
  //   let txReceipt: any = await tx.wait()
  //   if (txReceipt.events) {
  //     const requestId = txReceipt.events[1].topics[1]
  //     await kvOracle.reportKeyPairValidation(requestId, 0, false, true)
  //   }

  //   tx = await token.transferAndCall(
  //     adrs.kvOracle,
  //     toEther(5),
  //     ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'bool'], [0, true])
  //   )
  //   txReceipt = await tx.wait()
  //   if (txReceipt.events) {
  //     const requestId = txReceipt.events[1].topics[1]
  //     await expect(
  //       kvOracle.connect(signers[2]).reportKeyPairValidation(requestId, 0, true, false)
  //     ).to.be.revertedWith('Source must be the oracle of the request')
  //     await kvOracle.reportKeyPairValidation(requestId, 0, true, false)
  //   }

  //   let operator = (await nwlOpController.getOperators([0]))[0]
  //   assert.equal(operator[3], false)
  //   assert.equal(Number(operator[4]), 3)

  //   operator = (await wlOpController.getOperators([0]))[0]
  //   assert.equal(operator[3], false)
  //   assert.equal(Number(operator[4]), 0)
  // })
})
