require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const AdmZip = require('adm-zip');

const app = express(); // ✅ define app before using
app.use(bodyParser.json());

app.post('/runTrigger', async (req, res) => {
  const { apiVersion, orgUrl, sessionId, triggerApiName, status, bodyTrigger } = req.body;
  const API_VERSION = '' + apiVersion;

  if (!apiVersion || !orgUrl || !sessionId || !triggerApiName || !status || !bodyTrigger) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const accessToken = sessionId;
    const instanceUrl = orgUrl;
    console.log('✅ Logged in to Salesforce');

    // Step 1: Create ZIP with trigger files
    const zip = new AdmZip();

    const triggerBody = '' + bodyTrigger;
    zip.addFile(`triggers/${triggerApiName}.trigger`, Buffer.from(triggerBody));

    const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">
    <status>${status}</status>
    <apiVersion>${API_VERSION}</apiVersion>
</ApexTrigger>`;
    zip.addFile(`triggers/${triggerApiName}.trigger-meta.xml`, Buffer.from(metaXml));

    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>${triggerApiName}</members>
        <name>ApexTrigger</name>
    </types>
    <version>${API_VERSION}</version>
</Package>`;
    zip.addFile('package.xml', Buffer.from(packageXml));

    const zipBuffer = zip.toBuffer();
    console.log('📦 Metadata ZIP prepared');

    // Step 2: Deploy ZIP
    const deployUrl = `${instanceUrl}/services/Soap/m/${API_VERSION}`;
    const deployEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  xmlns="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <SessionHeader>
      <sessionId>${accessToken}</sessionId>
    </SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <deploy>
      <ZipFile>${zipBuffer.toString('base64')}</ZipFile>
      <DeployOptions>
        <performRetrieve>false</performRetrieve>
        <rollbackOnError>true</rollbackOnError>
        <singlePackage>true</singlePackage>
        <checkOnly>false</checkOnly>
        <testLevel>NoTestRun</testLevel>
      </DeployOptions>
    </deploy>
  </soapenv:Body>
</soapenv:Envelope>`;

    const deployHeaders = {
      'Content-Type': 'text/xml',
      'SOAPAction': 'deploy',
    };

    const deployResponse = await axios.post(deployUrl, deployEnvelope, { headers: deployHeaders });
    const deployIdMatch = deployResponse.data.match(/<id>(.*?)<\/id>/);
    if (!deployIdMatch) throw new Error('Deployment ID not found');

    const deployId = deployIdMatch[1];
    console.log(`🚀 Deployment started: ID = ${deployId}`);

    // Step 3: Poll deployment status
    const checkDeployEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <SessionHeader>
      <sessionId>${accessToken}</sessionId>
    </SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <checkDeployStatus>
      <asyncProcessId>${deployId}</asyncProcessId>
      <includeDetails>true</includeDetails>
    </checkDeployStatus>
  </soapenv:Body>
</soapenv:Envelope>`;

    let done = false;
    let pollCount = 0;
    let finalResponse;
    while (!done && pollCount < 10) {
      const checkResponse = await axios.post(deployUrl, checkDeployEnvelope, { headers: deployHeaders });
      finalResponse = checkResponse.data;
      done = /<done>true<\/done>/.test(finalResponse);

      if (!done) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        pollCount++;
      }
    }

    console.log('✅ Deployment completed');
    return res.status(200).json({ success: true, response: finalResponse });

  } catch (err) {
    console.error('❌ Error:', err?.response?.data || err.message || err.toString());
    return res.status(500).json({ error: err?.response?.data || err.message || err.toString() });
  }
});

// ✅ Now safely start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
