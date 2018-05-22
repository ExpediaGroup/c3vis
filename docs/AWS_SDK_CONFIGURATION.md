# Configuring AWS SDK

The c3vis server uses the AWS JavaScript SDK to connect to AWS APIs.

As per [Configuring the SDK for JavaScript](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/configuring-the-jssdk.html), the AWS JavaScript SDK will get its configuration from the server's environment.

## Provide Explicit AWS SDK Configuration with `aws_config.json` Configuration File

AWS SDK configuration can be overridden by providing an `aws_config.json` file (this file location is overridable with `aws.configFile` option, see [CONFIGURATION.md](CONFIGURATION.md)).

E.g. to set the region used by c3vis server to `us-east-1`, create an `aws_config.json` file in the root directory with the following:

```
{
  "region": "us-east-1"
}
```

The contents of this file override all other sources of AWS SDK configuration.  
The settings are applied to the AWS Global Configuration Object using `AWS.config.update()` as per [Using the Global Configuration Object](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/global-config-object.html)

## AWS Region

As per above section, AWS Region can be provided in local `aws_config.json` file.

Otherwise the Region will be configured as per [Setting the AWS Region](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-region.html).

## AWS Credentials

If using `aws_config.json` file as per above section, you can add AWS credentials properties `accessKeyId` and `secretAccessKey` to the `aws_config.json` 
See [https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-node-credentials-json-file.html](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-node-credentials-json-file.html).

*NOTE: Storing credentials in plaintext file is not recommended, especially if there is a risk this file could be committed to version control.*

Otherwise, the credentials will be loaded as per priority listed [here](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html).

## IAM Role Permissions

When using an IAM role, ensure the role has the following access:

* `ecs:listContainerInstances`
* `ecs:describeContainerInstances`
* `ecs:listTasks`
* `ecs:describeTasks`
* `ecs:describeTaskDefinition`
* `ecs:listClusters`
* `ec2:describeInstance`

Sample IAM Inline Policy:
```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ecs:listContainerInstances",
                "ecs:describeContainerInstances",
                "ecs:listTasks",
                "ecs:describeTasks",
                "ecs:describeTaskDefinition",
                "ecs:listClusters",
                "ec2:describeInstances"
            ],
            "Resource": [
                "*"
            ]
        }
    ]
}
```

**WARNING:** c3vis makes ECS data from the above API calls (including environment variables in task definitions) available to clients/browsers.
Ensure the c3vis server is available only to users that should have access to this information.
