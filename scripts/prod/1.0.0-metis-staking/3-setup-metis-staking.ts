import {
  DistributionOracle,
  PriorityPool,
  SequencerRewardsCCIPReceiver,
  SequencerVCS,
  StakingPool,
} from '../../../typechain-types'
import { getContract } from '../../utils/deployment'

const stMetisSDLPoolFee = 600 // basis point fee to be paid to SDL pool
const multisigAddress = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'

async function main() {
  const stakingPool = (await getContract('METIS_StakingPool', true)) as StakingPool
  const priorityPool = (await getContract('METIS_PriorityPool', true)) as PriorityPool
  const sequencerVCS = (await getContract('METIS_SequencerVCS', true)) as SequencerVCS
  const stMetisSDLRewardsPool = await getContract('stMETIS_SDLRewardsPool', true)
  const rewardsReceiver = (await getContract(
    'METIS_SequencerRewardsCCIPReceiver',
    true
  )) as SequencerRewardsCCIPReceiver
  const distributionOracle = (await getContract(
    'METIS_PP_DistributionOracle'
  )) as DistributionOracle

  console.log('Setting up contracts')

  await (await stakingPool.setPriorityPool(priorityPool.target)).wait()
  await (await stakingPool.addStrategy(sequencerVCS.target)).wait()
  await (await stakingPool.addFee(stMetisSDLRewardsPool.target, stMetisSDLPoolFee)).wait()
  await (await priorityPool.setDistributionOracle(distributionOracle.target)).wait()
  await (await sequencerVCS.setCCIPController(rewardsReceiver.target)).wait()

  console.log('Transferring ownership')

  await (await stakingPool.transferOwnership(multisigAddress)).wait()
  await (await priorityPool.transferOwnership(multisigAddress)).wait()
  await (await sequencerVCS.transferOwnership(multisigAddress)).wait()
  await (await rewardsReceiver.transferOwnership(multisigAddress)).wait()
  await (await distributionOracle.transferOwnership(multisigAddress)).wait()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
