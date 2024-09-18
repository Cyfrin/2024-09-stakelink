import fs from 'fs'
import { deployCore } from './modules/deploy-core'
import { deployLINKStaking } from './modules/deploy-link-staking'
import { deployMETISStaking } from './modules/deploy-metis-staking'
import { deployTestContracts } from './modules/deploy-test-contracts'

const path = './deployments/localhost.json'

async function main() {
  if (fs.existsSync(path)) {
    fs.unlinkSync(path)
  }

  await deployTestContracts()
  await deployCore()
  await deployLINKStaking()
  await deployMETISStaking()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
