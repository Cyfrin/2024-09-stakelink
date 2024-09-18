import { ethers, upgrades } from 'hardhat'
import { getContract } from '../../../utils/deployment'

async function main() {
  const operatorVCS = await getContract('LINK_OperatorVCS')

  const operatorVCSImp = (await upgrades.prepareUpgrade(
    operatorVCS.address,
    await ethers.getContractFactory('OperatorVCS'),
    {
      kind: 'uups',
    }
  )) as string
  console.log('OperatorVCS implementation deployed at: ', operatorVCSImp)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
