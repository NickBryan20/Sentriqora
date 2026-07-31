const [nodeMajorText] = process.versions.node.split('.');
const nodeMajor = Number.parseInt(nodeMajorText ?? '', 10);

if (nodeMajor !== 24) {
  process.stderr.write(
    `AegisFlow requires Node.js 24 LTS; current runtime is ${process.versions.node}.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Node.js ${process.versions.node} satisfies the AegisFlow runtime policy.\n`,
  );
}
