// import { ethers } from 'hardhat'
// import { Interface } from 'ethers/lib/utils'
// import { Signer } from 'ethers'
// import { toEther, deploy, deployUpgradeable, getAccounts } from '../utils/helpers'
// import { StrategyMock, GovernanceController } from '../../typechain-types'
// import { assert, expect } from 'chai'

// describe('GovernanceController', () => {
//   let govController: GovernanceController
//   let strategyInterface: Interface
//   let strategy: StrategyMock
//   let strategy2: StrategyMock
//   let signers: Signer[]
//   let accounts: string[]

//   const getSigHash = (func: string) => strategyInterface.getSighash(func)

//   const encodeFunctionData = (func: string, args: any = []) =>
//     strategyInterface.encodeFunctionData(func, args)

//   before(async () => {
//     ;({ signers, accounts } = await getAccounts())
//   })

//   beforeEach(async () => {
//     govController = (await deploy('GovernanceController')) as GovernanceController

//     strategyInterface = (await ethers.getContractFactory('StrategyMock')).interface as Interface

//     strategy = (await deployUpgradeable('StrategyMock', [
//       accounts[0],
//       accounts[0],
//       toEther(1000),
//       toEther(10),
//     ])) as StrategyMock

//     strategy2 = (await deployUpgradeable('StrategyMock', [
//       accounts[0],
//       accounts[0],
//       toEther(1000),
//       toEther(10),
//     ])) as StrategyMock

//     await strategy.transferOwnership(govController.address)
//     await strategy2.transferOwnership(govController.address)

//     await govController.addRole(
//       'Test',
//       [accounts[0], accounts[1]],
//       [strategy.address, strategy2.address],
//       [
//         [getSigHash('setMinDeposits(uint)'), getSigHash('setMaxDeposits(uint)')],
//         [getSigHash('setMinDeposits(uint)')],
//       ]
//     )
//   })

//   it('should be able to add roles', async () => {
//     await govController.addRole(
//       'Test2',
//       [accounts[0], accounts[1]],
//       [strategy.address, strategy2.address],
//       [
//         [getSigHash('setMinDeposits(uint)')],
//         [getSigHash('setMinDeposits(uint)'), getSigHash('setMaxDeposits(uint)')],
//       ]
//     )

//     assert.equal((await govController.getRoles())[1], 'Test2')
//     assert.equal(await govController.hasRole(1, accounts[0]), true)
//     assert.equal(await govController.hasRole(1, accounts[1]), true)
//     assert.equal(await govController.hasRole(1, accounts[2]), false)
//     assert.equal(
//       await govController.hasFunction(1, strategy.address, getSigHash('setMinDeposits(uint)')),
//       true
//     )
//     assert.equal(
//       await govController.hasFunction(1, strategy.address, getSigHash('setMaxDeposits(uint)')),
//       false
//     )
//     assert.equal(
//       await govController.hasFunction(1, strategy2.address, getSigHash('setMinDeposits(uint)')),
//       true
//     )
//     assert.equal(
//       await govController.hasFunction(1, strategy2.address, getSigHash('setMaxDeposits(uint)')),
//       true
//     )
//   })

//   it('should be able to grant roles', async () => {
//     await expect(govController.grantRole(0, accounts[0])).to.be.revertedWith(
//       'Account already holds role'
//     )

//     assert.equal(await govController.hasRole(0, accounts[2]), false)

//     await govController.grantRole(0, accounts[2])

//     assert.equal(await govController.hasRole(0, accounts[2]), true)
//   })

//   it('should be able to revoke roles', async () => {
//     await expect(govController.revokeRole(0, accounts[2])).to.be.revertedWith(
//       'Account does not hold role'
//     )

//     assert.equal(await govController.hasRole(0, accounts[0]), true)

//     await govController.revokeRole(0, accounts[0])

//     assert.equal(await govController.hasRole(0, accounts[0]), false)
//   })

//   it('should be able to renounce roles', async () => {
//     await expect(govController.connect(signers[2]).renounceRole(0)).to.be.revertedWith(
//       'Account does not hold role'
//     )

//     assert.equal(await govController.hasRole(0, accounts[0]), true)

//     await govController.renounceRole(0)

//     assert.equal(await govController.hasRole(0, accounts[0]), false)
//   })

//   it('should be able to add role functions', async () => {
//     await expect(
//       govController.addRoleFunctions(
//         0,
//         [strategy.address],
//         [[getSigHash('setFeeBasisPoints(uint)'), getSigHash('setMinDeposits(uint)')]]
//       )
//     ).to.be.revertedWith('Function is already part of role')

//     await govController.addRoleFunctions(
//       0,
//       [strategy2.address, strategy.address],
//       [
//         [getSigHash('setFeeBasisPoints(uint)'), getSigHash('setMaxDeposits(uint)')],
//         [getSigHash('simulateSlash(uint)')],
//       ]
//     )

//     assert.equal(
//       await govController.hasFunction(0, strategy2.address, getSigHash('setMaxDeposits(uint)')),
//       true
//     )
//     assert.equal(
//       await govController.hasFunction(0, strategy2.address, getSigHash('setFeeBasisPoints(uint)')),
//       true
//     )
//     assert.equal(
//       await govController.hasFunction(0, strategy.address, getSigHash('simulateSlash(uint)')),
//       true
//     )
//     assert.equal(
//       await govController.hasFunction(0, strategy.address, getSigHash('setFeeBasisPoints(uint)')),
//       false
//     )
//   })

//   it('should be able to remove role functions', async () => {
//     await expect(
//       govController.removeRoleFunctions(
//         0,
//         [strategy.address],
//         [[getSigHash('setFeeBasisPoints(uint)'), getSigHash('setMinDeposits(uint)')]]
//       )
//     ).to.be.revertedWith('Function is not part of role')

//     await govController.removeRoleFunctions(
//       0,
//       [strategy2.address, strategy.address],
//       [
//         [getSigHash('setMinDeposits(uint)')],
//         [getSigHash('setMaxDeposits(uint)'), getSigHash('setMinDeposits(uint)')],
//       ]
//     )

//     assert.equal(
//       await govController.hasFunction(0, strategy2.address, getSigHash('setMinDeposits(uint)')),
//       false
//     )
//     assert.equal(
//       await govController.hasFunction(0, strategy.address, getSigHash('setMaxDeposits(uint)')),
//       false
//     )
//     assert.equal(
//       await govController.hasFunction(0, strategy.address, getSigHash('setMinDeposits(uint)')),
//       false
//     )
//   })

//   it('callFunction should work as expected', async () => {
//     await expect(
//       govController
//         .connect(signers[2])
//         .callFunction(0, strategy.address, encodeFunctionData('setMinDeposits', ['0']))
//     ).to.be.revertedWith('Sender does not hold specified role')
//     await expect(
//       govController.callFunction(
//         0,
//         strategy.address,
//         encodeFunctionData('setFeeBasisPoints', ['0'])
//       )
//     ).to.be.revertedWith('Role is not authorized to call specified function')

//     await govController.addRoleFunctions(0, [strategy2.address], [[getSigHash('withdraw(uint)')]])

//     await expect(
//       govController.callFunction(0, strategy2.address, encodeFunctionData('withdraw', ['1']))
//     ).to.be.revertedWith('StakingPool only')

//     await govController.callFunction(
//       0,
//       strategy.address,
//       encodeFunctionData('setMinDeposits', ['0'])
//     )
//     assert.equal((await strategy.getMinDeposits()).toNumber(), 0)

//     await govController
//       .connect(signers[1])
//       .callFunction(0, strategy.address, encodeFunctionData('setMinDeposits', ['1']))
//     assert.equal((await strategy.getMinDeposits()).toNumber(), 1)
//   })
// })
