import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwv2authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Orders DynamoDB Table ──
    const ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: 'knead-bake-orders',
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    ordersTable.addGlobalSecondaryIndex({
      indexName: 'by-pickup-date',
      partitionKey: { name: 'pickupDate', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    ordersTable.addGlobalSecondaryIndex({
      indexName: 'by-status',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── Market Config DynamoDB Table ──
    const configTable = new dynamodb.Table(this, 'MarketConfigTable', {
      tableName: 'knead-bake-market-config',
      partitionKey: { name: 'type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    // ── Orders Lambda ──
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
        SEND_EMAILS: 'false',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    ordersTable.grantWriteData(orderFn);

    orderFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/kneadandbaketx.com`,
        `arn:aws:ses:${this.region}:${this.account}:identity/*@kneadandbaketx.com`,
      ],
    }));

    // ── Auth Lambda (login) ──
    const authFn = new lambda.Function(this, 'AuthFunction', {
      functionName: 'knead-bake-auth',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'auth')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        CONFIG_TABLE: configTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    configTable.grantReadWriteData(authFn);

    // SSM read access for password hash and JWT secret
    authFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/knead-bake/*`,
      ],
    }));

    // ── Authorizer Lambda (JWT verification) ──
    const authorizerFn = new lambda.Function(this, 'AuthorizerFunction', {
      functionName: 'knead-bake-authorizer',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'authorizer')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    authorizerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/knead-bake/*`,
      ],
    }));

    // ── Admin Lambda (CRUD + public market-config) ──
    const adminFn = new lambda.Function(this, 'AdminFunction', {
      functionName: 'knead-bake-admin',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'admin')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        CONFIG_TABLE: configTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    configTable.grantReadWriteData(adminFn);

    // ── API Gateway HTTP API ──
    const httpApi = new apigwv2.HttpApi(this, 'OrderApi', {
      apiName: 'knead-bake-api',
      description: 'Knead & Bake TX order and admin API',
      corsPreflight: {
        allowOrigins: [
          'https://kneadandbaketx.com',
          'https://www.kneadandbaketx.com',
          'http://localhost:3000',
          'http://localhost:8080',
          'https://d7xgnh51ijjd2.cloudfront.net',
        ],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Lambda authorizer for admin routes
    const jwtAuthorizer = new apigwv2authorizers.HttpLambdaAuthorizer('AdminAuthorizer', authorizerFn, {
      authorizerName: 'knead-bake-admin-authorizer',
      responseTypes: [apigwv2authorizers.HttpLambdaResponseType.SIMPLE],
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    // ── Routes ──

    // POST /api/orders (existing)
    httpApi.addRoutes({
      path: '/api/orders',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration('OrderIntegration', orderFn),
    });

    // POST /api/auth/login (public)
    httpApi.addRoutes({
      path: '/api/auth/login',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration('AuthIntegration', authFn),
    });

    // GET /api/market-config (public)
    httpApi.addRoutes({
      path: '/api/market-config',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration('MarketConfigIntegration', adminFn),
    });

    // Admin routes (protected by JWT authorizer)
    const adminIntegration = new apigwv2integrations.HttpLambdaIntegration('AdminIntegration', adminFn);

    httpApi.addRoutes({
      path: '/api/admin/skip-dates',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/api/admin/skip-dates/{id}',
      methods: [apigwv2.HttpMethod.DELETE],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/api/admin/announcements',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/api/admin/announcements/{id}',
      methods: [apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    // GET /api/news (public — news posts)
    httpApi.addRoutes({
      path: '/api/news',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration('NewsPublicIntegration', adminFn),
    });

    // Admin news routes (protected by JWT authorizer)
    httpApi.addRoutes({
      path: '/api/admin/news',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/api/admin/news/{id}',
      methods: [apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    // ── Outputs ──
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, 'OrdersTableName', {
      value: ordersTable.tableName,
    });

    new cdk.CfnOutput(this, 'ConfigTableName', {
      value: configTable.tableName,
    });
  }
}
