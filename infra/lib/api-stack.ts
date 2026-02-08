import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── DynamoDB Table ──
    const ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: 'knead-bake-orders',
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying by pickup date
    ordersTable.addGlobalSecondaryIndex({
      indexName: 'by-pickup-date',
      partitionKey: { name: 'pickupDate', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by status
    ordersTable.addGlobalSecondaryIndex({
      indexName: 'by-status',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── Lambda Function ──
    const orderFn = new lambda.Function(this, 'OrderFunction', {
      functionName: 'knead-bake-orders',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'orders')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        ORDERS_TABLE: ordersTable.tableName,
        OWNER_EMAIL: 'orders@kneadandbaketx.com',
        FROM_EMAIL: 'noreply@kneadandbaketx.com',
        SEND_EMAILS: 'false', // Set to 'true' after verifying SES identities
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Grant DynamoDB write access (least privilege)
    ordersTable.grantWriteData(orderFn);

    // Grant SES send access (scoped to the domain)
    orderFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/kneadandbaketx.com`,
        `arn:aws:ses:${this.region}:${this.account}:identity/*@kneadandbaketx.com`,
      ],
    }));

    // ── API Gateway HTTP API ──
    const httpApi = new apigwv2.HttpApi(this, 'OrderApi', {
      apiName: 'knead-bake-api',
      description: 'Knead & Bake TX order API',
      corsPreflight: {
        allowOrigins: [
          'https://kneadandbaketx.com',
          'https://www.kneadandbaketx.com',
          'http://localhost:3000',
          'http://localhost:8080',
        ],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // POST /api/orders
    httpApi.addRoutes({
      path: '/api/orders',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration('OrderIntegration', orderFn),
    });

    // ── Throttling via stage (default stage) ──
    // API Gateway HTTP API has built-in throttling defaults (10k rps, 5k burst).
    // For tighter limits, use WAF or usage plans on REST API.

    // ── Outputs ──
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, 'OrdersTableName', {
      value: ordersTable.tableName,
    });
  }
}
