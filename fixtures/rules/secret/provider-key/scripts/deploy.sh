#!/bin/sh
export AWS_ACCESS_KEY_ID={{fake:aws-access-key}} # expect: secret/provider-key
# ok: the AWS documentation example key is not a credential
export EXAMPLE_KEY=AKIAIOSFODNN7EXAMPLE
aws s3 sync ./out s3://acme-site
