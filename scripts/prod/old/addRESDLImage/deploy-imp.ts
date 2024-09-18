import { ethers, upgrades } from 'hardhat'
import { getContract } from '../../../utils/deployment'
import { SDLPool } from '../../../../typechain-types'

async function main() {
  const sdlPool = (await getContract('SDLPool')) as SDLPool

  const sdlPoolImp = (await upgrades.prepareUpgrade(
    sdlPool.address,
    await ethers.getContractFactory('SDLPool'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('SDLPool implementation deployed at: ', sdlPoolImp)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
