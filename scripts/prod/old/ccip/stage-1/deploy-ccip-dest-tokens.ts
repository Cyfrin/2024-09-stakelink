import { updateDeployments, deploy } from '../../../../utils/deployment'

// SDL
const sdl = {
  name: 'stake.link',
  symbol: 'SDL',
  decimals: 18,
}
// wstLINK
const wstLINK = {
  name: 'Wrapped stLINK',
  symbol: 'wstLINK',
  decimals: 18,
}

async function main() {
  const sdlToken = await deploy('BurnMintERC677', [sdl.name, sdl.symbol, sdl.decimals, 0])
  console.log('SDLToken deployed: ', sdlToken.address)

  const wrappedSDToken = await deploy('BurnMintERC677', [
    wstLINK.name,
    wstLINK.symbol,
    wstLINK.decimals,
    0,
  ])
  console.log('LINK_WrappedSDToken deployed: ', wrappedSDToken.address)

  updateDeployments(
    {
      SDLToken: sdlToken.address,
      LINK_WrappedSDToken: wrappedSDToken.address,
    },
    { SDLToken: 'BurnMintERC677', LINK_wrappedSDToken: 'BurnMintERC677' }
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
