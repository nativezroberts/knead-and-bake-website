#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StaticSiteStack } from '../lib/static-site-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
};

// Static site: S3 + CloudFront (+ optional Route 53 + ACM)
const site = new StaticSiteStack(app, 'KneadBakeSite', {
  env,
  description: 'Knead & Bake TX - static site (S3 + CloudFront)',
});

// API: API Gateway + Lambda + DynamoDB (+ SES + WAF)
// Set sesSandbox to false once SES is out of sandbox and domain is verified.
// To switch back to sandbox mode: change to true and redeploy.
new ApiStack(app, 'KneadBakeApi', {
  env,
  siteBucket: site.siteBucket,
  sesSandbox: false,
  description: 'Knead & Bake TX - order API (APIGW + Lambda + DynamoDB)',
});

app.synth();
