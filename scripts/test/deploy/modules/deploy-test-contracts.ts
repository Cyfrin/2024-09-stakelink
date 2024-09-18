import { updateDeployments, deploy } from '../../../utils/deployment'

export async function deployTestContracts() {
  const lplToken = await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
    'LinkPool',
    'LPL',
    100000000,
  ])
  console.log('LPLToken deployed: ', lplToken.target)

  const linkToken = await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
    'Chainlink',
    'LINK',
    1000000000,
  ])
  console.log('LINKToken deployed: ', linkToken.target)

  const multicall = await deploy('Multicall3', [])
  console.log('Multicall3 deployed: ', multicall.target)

  const poolOwners = await deploy('PoolOwnersV1', [lplToken.target])
  console.log('PoolOwners (v1) deployed: ', poolOwners.target)

  const ownersRewardsPoolV1 = await deploy('OwnersRewardsPoolV1', [
    poolOwners.target,
    linkToken.target,
    'LinkPool Owners LINK',
    'lpoLINK',
  ])
  console.log('LINK OwnersRewardsPool (v1) deployed: ', ownersRewardsPoolV1.target)

  const poolAllowance = await deploy('PoolAllowanceV1', [
    'LINK LinkPool Allowance',
    'linkLPLA',
    poolOwners.target,
  ])
  console.log('PoolAllowance (v1) deployed: ', multicall.target)

  let tx = await poolOwners.addRewardToken(
    linkToken.target,
    poolAllowance.target,
    ownersRewardsPoolV1.target
  )
  await tx.wait()

  updateDeployments(
    {
      LPLToken: lplToken.target,
      LINKToken: linkToken.target,
      PoolOwnersV1: poolOwners.target,
      LINK_OwnersRewardsPoolV1: ownersRewardsPoolV1.target,
      PoolAllowanceV1: poolAllowance.target,
      Multicall3: multicall.target,
    },
    {
      LPLToken: 'contracts/core/tokens/base/ERC677.sol:ERC677',
      LINKToken: 'contracts/core/tokens/base/ERC677.sol:ERC677',
      LINK_OwnersRewardsPoolV1: 'OwnersRewardsPoolV1',
    }
  )
}
