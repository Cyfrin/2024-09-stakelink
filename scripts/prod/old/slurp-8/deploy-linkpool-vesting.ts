import { updateDeployments, deploy } from '../../utils/deployment'

const multisig = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'
const beneficiary = '0x311500AfdF67046989D006Ca38059F6807889238'
const vestingStart = 1695312000 // Sep 21 2023 12pm EDT
const vestingDuration = 4 * 365 * 86400 // 4 years

async function main() {
  let vesting = await deploy('Vesting', [multisig, beneficiary, vestingStart, vestingDuration])
  console.log('Vesting for', beneficiary, 'deployed: ', vesting.address)
  updateDeployments(
    {
      [`SDL_Vesting_LinkPool`]: vesting.address,
    },
    {
      [`SDL_Vesting_LinkPool`]: 'Vesting',
    }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
