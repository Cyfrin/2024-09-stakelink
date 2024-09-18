const child_process = require('child_process')

// Start hardhat, wait for `deploy-status-ready` status, then run mock data script

async function compile() {
  const child = child_process.spawn('npx', ['yarn', 'compile'])

  child.stdout.on('data', (data) => {
    console.log('yarn compile - process (' + child.pid + '): ' + data)
  })

  child.stderr.on('data', (data) => {
    console.error('yarn compile - process (' + child.pid + ') (stderr): ' + data)
  })

  return await new Promise((resolve) => {
    child.on('close', () => {
      resolve('success')
    })
  })
}

async function startHardhat() {
  const child = child_process.spawn('npx', ['yarn', 'start'])

  child.stdout.on('data', (data) => {
    console.log('yarn start - process (' + child.pid + '): ' + data)
  })

  child.stderr.on('data', (data) => {
    console.error('yarn start - process (' + child.pid + ') (stderr): ' + data)
  })

  return await new Promise((resolve) => {
    child.stdout.on('data', (data) => {
      if (data.toString().includes('Mined empty block')) {
        resolve('success')
      }
    })
  })
}

async function deploy() {
  const child = child_process.spawn('npx', ['yarn', 'deploy'])

  child.stdout.on('data', (data) => {
    console.log('yarn deploy - process (' + child.pid + '): ' + data)
  })

  child.stderr.on('data', (data) => {
    console.error('yarn deploy - process (' + child.pid + ') (stderr): ' + data)
  })

  return await new Promise((resolve) => {
    child.on('close', () => {
      resolve('success')
    })
  })
}

async function testnEnv() {
  const child = child_process.spawn('npx', ['yarn', 'setup-test-env'])

  child.stdout.on('data', (data) => {
    console.log('yarn setup-test-env - process (' + child.pid + '): ' + data)
  })

  child.stderr.on('data', (data) => {
    console.error('yarn setup-test-env - process (' + child.pid + ') (stderr): ' + data)
  })

  return await new Promise((resolve) => {
    child.on('close', () => {
      resolve('success')
    })
  })
}

async function run() {
  await compile()
  await startHardhat()
  await deploy()
  await testnEnv()
}

run().catch((error) => {
  console.log('error', error)
  console.error(error)
  process.exit(1)
})
