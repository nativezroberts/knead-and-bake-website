import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwv2authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import * as path from 'path';

interface ApiStackProps extends cdk.StackProps {
  siteBucket: s3.IBucket;
  /**
   * When true, customer confirmation emails are suppressed (only owner
   * receives notifications). Set to false once SES is in production mode
   * and the sending domain is verified.
   * @default true
   */
  sesSandbox?: boolean;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
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

    // ── Admin Audit Log DynamoDB Table ──
    const auditTable = new dynamodb.Table(this, 'AuditLogTable', {
      tableName: 'knead-bake-audit-log',
      partitionKey: { name: 'resourceType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'auditId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
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
        CONFIG_TABLE: configTable.tableName,
        OWNER_EMAIL: 'allyson.m.roberts@gmail.com',
        FROM_EMAIL: 'noreply@kneadandbaketx.com',
        SEND_EMAILS: 'true',
        SES_SANDBOX: (props.sesSandbox ?? true).toString(),
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    ordersTable.grantReadWriteData(orderFn);
    configTable.grantReadWriteData(orderFn);

    orderFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/kneadandbaketx.com`,
        `arn:aws:ses:${this.region}:${this.account}:identity/*@kneadandbaketx.com`,
        `arn:aws:ses:${this.region}:${this.account}:identity/allyson.m.roberts@gmail.com`,
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
        ORDERS_TABLE: ordersTable.tableName,
        AUDIT_TABLE: auditTable.tableName,
        OWNER_EMAIL: 'allyson.m.roberts@gmail.com',
        FROM_EMAIL: 'noreply@kneadandbaketx.com',
        SEND_EMAILS: 'true',
        SITE_BUCKET: props.siteBucket.bucketName,
        SITE_UPLOAD_PREFIX: 'news-images',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    configTable.grantReadWriteData(adminFn);
    ordersTable.grantReadWriteData(adminFn);
    auditTable.grantWriteData(adminFn);
    props.siteBucket.grantPut(adminFn, 'news-images/*');

    adminFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/kneadandbaketx.com`,
        `arn:aws:ses:${this.region}:${this.account}:identity/*@kneadandbaketx.com`,
        `arn:aws:ses:${this.region}:${this.account}:identity/allyson.m.roberts@gmail.com`,
      ],
    }));

    // ── Payments Lambda (Square Web Payments) ──
    const paymentFn = new lambda.Function(this, 'PaymentFunction', {
      functionName: 'knead-bake-payments',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'payments')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      environment: {
        ORDERS_TABLE: ordersTable.tableName,
        OWNER_EMAIL: 'allyson.m.roberts@gmail.com',
        FROM_EMAIL: 'noreply@kneadandbaketx.com',
        SEND_EMAILS: 'true',
        SES_SANDBOX: (props.sesSandbox ?? true).toString(),
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    ordersTable.grantReadWriteData(paymentFn);

    // SSM read access for Square credentials
    paymentFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/knead-bake/*`,
      ],
    }));

    paymentFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/kneadandbaketx.com`,
        `arn:aws:ses:${this.region}:${this.account}:identity/*@kneadandbaketx.com`,
        `arn:aws:ses:${this.region}:${this.account}:identity/allyson.m.roberts@gmail.com`,
      ],
    }));

    // ── API Gateway HTTP API ──
    const httpApi = new apigwv2.HttpApi(this, 'OrderApi', {
      apiName: 'knead-bake-api',
      description: 'Knead & Bake TX order and admin API',
      corsPreflight: {
        allowOrigins: [
          'https://kneadandbaketx.com',
          'https://www.kneadandbaketx.com',
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

    httpApi.addRoutes({
      path: '/api/orders/{orderId}/payment-choice',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration('OrderPaymentChoiceIntegration', orderFn),
    });

    // POST /api/payments (public — Square card payment after order)
    httpApi.addRoutes({
      path: '/api/payments',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration('PaymentIntegration', paymentFn),
    });

    httpApi.addRoutes({
      path: '/api/payments/config',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration('PaymentConfigIntegration', paymentFn),
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

    // GET /api/inventory (public — product availability for preorder form)
    httpApi.addRoutes({
      path: '/api/inventory',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration('InventoryPublicIntegration', adminFn),
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
      path: '/api/admin/news/upload-url',
      methods: [apigwv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/api/admin/news/{id}',
      methods: [apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    // Admin inventory routes (protected by JWT authorizer)
    httpApi.addRoutes({
      path: '/api/admin/inventory',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/api/admin/inventory/reset',
      methods: [apigwv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/api/admin/inventory/{sku}',
      methods: [apigwv2.HttpMethod.PUT],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    // Admin preorder summary routes (protected by JWT authorizer)
    httpApi.addRoutes({
      path: '/api/admin/preorders/summary',
      methods: [apigwv2.HttpMethod.GET],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: '/api/admin/preorders/email-summary',
      methods: [apigwv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    // Admin order rejection route (protected by JWT authorizer)
    httpApi.addRoutes({
      path: '/api/admin/orders/{orderId}/reject',
      methods: [apigwv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    // Admin order payment status route (protected by JWT authorizer)
    httpApi.addRoutes({
      path: '/api/admin/orders/{orderId}/pay',
      methods: [apigwv2.HttpMethod.POST],
      integration: adminIntegration,
      authorizer: jwtAuthorizer,
    });

    // ── Preorder Scheduler Lambda ──
    // Sends automated preorder summary emails:
    //   Friday 7 PM CDT  = 23:00 UTC  → cron(0 23 ? * FRI *)
    //   Saturday 9 AM CDT = 14:00 UTC → cron(0 14 ? * SAT *)
    // (CDT = UTC-5, active during market season Mar–Nov)
    const schedulerFn = new lambda.Function(this, 'SchedulerFunction', {
      functionName: 'knead-bake-scheduler',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'scheduler')),
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ORDERS_TABLE: ordersTable.tableName,
        OWNER_EMAIL: 'allyson.m.roberts@gmail.com',
        FROM_EMAIL: 'noreply@kneadandbaketx.com',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    ordersTable.grantReadData(schedulerFn);

    schedulerFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/kneadandbaketx.com`,
        `arn:aws:ses:${this.region}:${this.account}:identity/*@kneadandbaketx.com`,
        `arn:aws:ses:${this.region}:${this.account}:identity/allyson.m.roberts@gmail.com`,
      ],
    }));

    // Friday 7 PM CDT (23:00 UTC) — weekly preview
    new events.Rule(this, 'SchedulerFridayRule', {
      ruleName: 'knead-bake-friday-preview',
      description: 'Trigger preorder summary email every Friday at 7 PM CDT',
      schedule: events.Schedule.cron({ minute: '0', hour: '23', weekDay: 'FRI' }),
      targets: [new eventsTargets.LambdaFunction(schedulerFn)],
    });

    // Saturday 9 AM CDT (14:00 UTC) — market day final list
    new events.Rule(this, 'SchedulerSaturdayRule', {
      ruleName: 'knead-bake-saturday-morning',
      description: 'Trigger preorder summary email every Saturday at 9 AM CDT',
      schedule: events.Schedule.cron({ minute: '0', hour: '14', weekDay: 'SAT' }),
      targets: [new eventsTargets.LambdaFunction(schedulerFn)],
    });

    // Saturday 9:01 AM CDT (14:01 UTC) — auto-reset inventory for next week
    new events.Rule(this, 'InventoryResetRule', {
      ruleName: 'knead-bake-inventory-reset',
      description: 'Auto-reset inventory to weekly defaults every Saturday at 9:01 AM CDT',
      schedule: events.Schedule.cron({ minute: '1', hour: '14', weekDay: 'SAT' }),
      targets: [new eventsTargets.LambdaFunction(adminFn)],
    });

    // ── CloudWatch Alarms + SNS Alerting ──
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'knead-bake-alarms',
      displayName: 'Knead & Bake Lambda Alarms',
    });
    alarmTopic.addSubscription(
      new snsSubscriptions.EmailSubscription('allyson.m.roberts@gmail.com')
    );

    const alarmAction = new cloudwatchActions.SnsAction(alarmTopic);

    const monitoredLambdas: Array<[string, lambda.Function]> = [
      ['orders', orderFn],
      ['auth', authFn],
      ['admin', adminFn],
      ['payments', paymentFn],
    ];

    for (const [name, fn] of monitoredLambdas) {
      const alarm = new cloudwatch.Alarm(this, `${name}-error-alarm`, {
        alarmName: `knead-bake-${name}-errors`,
        alarmDescription: `Error rate spike in knead-bake-${name} Lambda`,
        metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
        threshold: 3,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
      alarm.addAlarmAction(alarmAction);
    }

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
