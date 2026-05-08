#!/usr/bin/env python3
"""
send-review-email.py — Send the weekly Knead & Bake post review email via AWS SES.

Usage:
  python3 tools/send-review-email.py \
    --subject "Weekly Post Ready — [Title]" \
    --html-file path/to/email-body.html \
    [--text-file path/to/email-body.txt]

Or import and call send_email() directly from another script.
"""

import argparse
import configparser
import os
import sys
import boto3
from botocore.exceptions import ClientError

CREDS_FILE = os.path.join(os.path.dirname(__file__), '..', '.ses-credentials')
FROM_EMAIL = 'noreply@kneadandbaketx.com'
TO_EMAILS  = ['allyson.m.roberts@gmail.com', 'zachary.w.roberts@gmail.com']
REGION     = 'us-east-1'


def load_credentials(creds_file):
    cfg = configparser.ConfigParser()
    cfg.read(os.path.abspath(creds_file))
    section = 'default'
    return (
        cfg[section]['aws_access_key_id'].strip(),
        cfg[section]['aws_secret_access_key'].strip(),
        cfg[section].get('region', REGION).strip(),
    )


def send_email(subject: str, html_body: str, text_body: str = None,
               to: list = None, from_addr: str = FROM_EMAIL,
               creds_file: str = CREDS_FILE):
    key_id, secret, region = load_credentials(creds_file)
    client = boto3.client(
        'ses',
        region_name=region,
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
    )
    recipients = to or TO_EMAILS
    body = {'Html': {'Data': html_body, 'Charset': 'UTF-8'}}
    if text_body:
        body['Text'] = {'Data': text_body, 'Charset': 'UTF-8'}

    response = client.send_email(
        Source=from_addr,
        Destination={'ToAddresses': recipients},
        Message={
            'Subject': {'Data': subject, 'Charset': 'UTF-8'},
            'Body': body,
        },
    )
    return response['MessageId']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Send review email via SES')
    parser.add_argument('--subject', required=True)
    parser.add_argument('--html-file', required=True)
    parser.add_argument('--text-file', default=None)
    args = parser.parse_args()

    with open(args.html_file, 'r') as f:
        html = f.read()
    text = None
    if args.text_file:
        with open(args.text_file, 'r') as f:
            text = f.read()

    try:
        msg_id = send_email(args.subject, html, text)
        print(f"✅ Email sent! MessageId: {msg_id}")
    except ClientError as e:
        print(f"❌ SES error: {e.response['Error']['Message']}", file=sys.stderr)
        sys.exit(1)
