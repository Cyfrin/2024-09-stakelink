import { updateDeployments, deploy } from '../../utils/deployment'

const multisig = '0xB351EC0FEaF4B99FdFD36b484d9EC90D0422493D'
const nops = [
  '0x20C0B7b370c97ed139aeA464205c05fCeAF4ac68',
  '0x26119F458dD1E8780554e3e517557b9d290Fb4dD',
  '0x479F6833BC5456b00276473DB1bD3Ee93ff8E3e2',
  '0xF2aD781cFf42E1f506b78553DA89090C65b1A847',
  '0xc316276f87019e5adbc3185A03e23ABF948A732D',
  '0xfAE26207ab74ee528214ee92f94427f8Cdbb6A32',
  '0x4dc81f63CB356c1420D4620414f366794072A3a8',
  '0xa0181758B14EfB2DAdfec66d58251Ae631e2B942',
  '0xcef3Da64348483c65dEC9CB1f59DdF46B0149755',
  '0xE2b7cBA5E48445f9bD17193A29D7fDEb4Effb078',
  '0x06c28eEd84E9114502d545fC5316F24DAa385c75',
  '0x6eF38c3d1D85B710A9e160aD41B912Cb8CAc2589',
  '0x3F44C324BD76E031171d6f2B87c4FeF00D4294C2',
  '0xd79576F14B711406a4D4489584121629329dFa2C',
]
const vestingStart = 1695312000 // Sep 21 2023 12pm EDT
const vestingDuration = 4 * 365 * 86400 // 4 years

async function main() {
  for (let i = 0; i < nops.length; i++) {
    let vesting = await deploy('Vesting', [multisig, nops[i], vestingStart, vestingDuration])
    console.log('Vesting for', nops[i], 'deployed: ', vesting.address)
    updateDeployments(
      {
        [`SDL_Vesting_NOP${i}`]: vesting.address,
      },
      {
        [`SDL_Vesting_NOP${i}`]: 'Vesting',
      }
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
