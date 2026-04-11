import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class StaticSiteStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly siteBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── S3 Bucket (private, OAC access only) ──
    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `knead-bake-site-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD, s3.HttpMethods.PUT],
          allowedOrigins: [
            'https://kneadandbaketx.com',
            'https://www.kneadandbaketx.com',
            'https://d7xgnh51ijjd2.cloudfront.net',
            'http://localhost:3000',
            'http://localhost:8080',
          ],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
    });

    // ── CloudFront Origin Access Control ──
    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // ── CloudFront Function for clean URLs ──
    const urlRewriteFunction = new cloudfront.Function(this, 'UrlRewrite', {
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          var uri = request.uri;

          // If URI ends with '/' add index.html
          if (uri.endsWith('/')) {
            request.uri += 'index.html';
          }
          // If URI doesn't have a file extension, add .html
          else if (!uri.includes('.')) {
            request.uri += '.html';
          }

          return request;
        }
      `),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // ── Security Response Headers ──
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: 'KneadBakeSecurityHeaders',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://web.squarecdn.com https://sandbox.web.squarecdn.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: https://www.google-analytics.com",
            "connect-src 'self' https://3db1s4oqy5.execute-api.us-east-1.amazonaws.com https://www.google-analytics.com https://www.googletagmanager.com https://pci-connect.squareup.com",
            "frame-src 'self' https://pci-connect.squareup.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    // ── Short-lived cache policy for dynamic content (HTML, JSON) ──
    const shortCachePolicy = new cloudfront.CachePolicy(this, 'ShortCachePolicy', {
      cachePolicyName: 'KneadBakeShortCache',
      defaultTtl: cdk.Duration.seconds(60),
      maxTtl: cdk.Duration.seconds(180),
      minTtl: cdk.Duration.seconds(0),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // ── S3 origin (shared by all behaviors) ──
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket, {
      originAccessControl: oac,
    });

    // ── CloudFront Distribution ──
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Knead & Bake TX',
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,

      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [{
          function: urlRewriteFunction,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },

      additionalBehaviors: {
        '/content/*': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: shortCachePolicy,
          responseHeadersPolicy: securityHeaders,
        },
      },

      // Custom error responses for SPA-like behavior
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    // ── Deploy site files to S3 ──
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'dist'))],
      destinationBucket: this.siteBucket,
      prune: false, // keep admin-uploaded assets (e.g. /news-images/*) between deploys
      distribution: this.distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
    });

    // ── Outputs ──
    new cdk.CfnOutput(this, 'BucketName', {
      value: this.siteBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
    });

    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
    });
  }
}
