require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

app.post('/runTrigger', (req, res) => {
  const { apiVersion, orgUrl, sessionId, triggerApiName, status, bodyTrigger } = req.body;
  const API_VERSION = '' + apiVersion;

  if (!apiVersion || !orgUrl || !sessionId || !triggerApiName || !status || !bodyTrigger) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const accessToken = sessionId;
  const instanceUrl = orgUrl;

  console.log('✅ Logged in to Salesforce');

  // Create ZIP with trigger and metadata
  const zip = new AdmZip();

  zip.addFile(`triggers/${triggerApiName}.trigger`, Buffer.from(bodyTrigger));

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

  axios.post(deployUrl, deployEnvelope, { headers: deployHeaders })
    .then((deployResponse) => {
      const match = deployResponse.data.match(/<id>(.*?)<\/id>/);
      if (!match) throw new Error('Deployment ID not found');

      const deployId = match[1];
      console.log(`🚀 Deployment started: ID = ${deployId}`);

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

      const statusUrl = `${instanceUrl}/services/Soap/m/${API_VERSION}`;
      let pollCount = 0;

      const pollStatus = () => {
        axios.post(statusUrl, checkDeployEnvelope, { headers: deployHeaders })
          .then((checkResponse) => {
            const responseData = checkResponse.data;
            const done = /<done>true<\/done>/.test(responseData);

            if (done || pollCount >= 10) {
              console.log('✅ Deployment completed');
              res.status(200).json({ success: true, response: responseData });
            } else {
              pollCount++;
              setTimeout(pollStatus, 3000);
            }
          })
          .catch((err) => {
            console.error('❌ Error polling deployment status:', err?.response?.data || err.message);
            res.status(500).json({ error: err?.response?.data || err.message });
          });
      };

      pollStatus();
    })
    .catch((err) => {
      console.error('❌ Deployment error:', err?.response?.data || err.message);
      res.status(500).json({ error: err?.response?.data || err.message });
    });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
