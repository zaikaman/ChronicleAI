import fs from 'node:fs';
import path from 'node:path';

function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath, fileList);
    } else if (filePath.endsWith('.json')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const workflowsDir = path.resolve(process.cwd(), 'workflows');
const jsonFiles = walkDir(workflowsDir);

let updatedCount = 0;
for (const file of jsonFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  if (content.includes('{{@trigger-manual.') || content.includes('{{@trigger-manual:Trigger.')) {
    let newContent = content.replaceAll('{{@trigger-manual:Trigger.', '{{@trigger-manual:Manual / API Trigger.');
    newContent = newContent.replaceAll('{{@trigger-manual.', '{{@trigger-manual:Manual / API Trigger.');
    fs.writeFileSync(file, newContent, 'utf-8');
    console.log(`Updated: ${file}`);
    updatedCount++;
  }
}

console.log(`Finished updating ${updatedCount} files.`);
