async function testEtherscanSortDesc() {
  const apiKey = process.env.ETHERSCAN_API_KEY?.trim();
  if (!apiKey) throw new Error("ETHERSCAN_API_KEY is required to query Etherscan");
  const targetContract = "0x2BD57c3Ca216F0D38B18BCFD14595F12DfB13C35";
  const urlV2 = `https://api.etherscan.io/v2/api?chainid=11155111&module=logs&action=getLogs&address=${targetContract}&page=1&offset=100&sort=desc&apikey=${apiKey}`;

  console.log("Fetching Etherscan logs with sort=desc...");
  const res = await fetch(urlV2);
  const data: any = await res.json();
  console.log("Total Etherscan logs returned:", data.result?.length);

  const watchStarts = new Date("2026-07-29T13:25:31.769+00:00").getTime();
  const watchEnds = new Date("2026-07-29T14:25:31.769+00:00").getTime();

  console.log("Watch window start:", new Date(watchStarts).toISOString());
  console.log("Watch window end:  ", new Date(watchEnds).toISOString());

  let matchedInWindow = 0;
  for (const item of (data.result || [])) {
    const tsSec = parseInt(item.timeStamp, 16) || parseInt(item.timeStamp, 10);
    const tsIso = new Date(tsSec * 1000).toISOString();
    const inWindow = tsSec * 1000 >= watchStarts && tsSec * 1000 <= watchEnds;
    if (inWindow) {
      matchedInWindow++;
      console.log(`MATCHED LOG! tx: ${item.transactionHash} block: ${item.blockNumber} time: ${tsIso}`);
    } else {
      console.log(`Log tx: ${item.transactionHash.slice(0, 16)}... block: ${item.blockNumber} time: ${tsIso} inside window? false`);
    }
  }
  console.log(`Total matched inside watch window: ${matchedInWindow}`);
}

testEtherscanSortDesc().catch(console.error);
