# c3vis - Cloud Container Cluster Visualizer

Helps visualize the resource reservation of Amazon ECS clusters.

Deploying software as “containers” promises to solve many problems with regards to interoperability of environments, speed to deploy, and cost reduction.
But understanding where our software lives now becomes more difficult both for development and operations teams.
This is due to the fact that it is quite laborious to find the information indicating where the software is now located and the quantity of resources still available for more software.
Several ECS console screens must be viewed, and the amount of time required to process this information grows with the amount of software deployed.
 
The Cloud Container Cluster Visualizer (c3vis) aims to give administrators and teams one place to gain rapid insight into the state of where the containers are running and the capacity available for more containers.

![alt tag](docs/graph.png)

The visualization displays the EC2 instances in the selected cluster as vertical bars.  The Tasks allocated to the instances are represented as stacked boxes indicating their reserved memory or CPU.
Each unique Task Definition is represented as a different color, with the legend showing the Task Family name and revision number.
Each Task will contain one or more containers, the task box shows accumulated reserved memory or CPU for all containers in the Task. ECS Services are not currently represented.


## Configuration

See [CONFIGURATION](docs/CONFIGURATION.md) for details on server-side configurable options that affect cache entry TTL and AWS API call throttling.

## Configuring AWS SDK

See [AWS_SDK_CONFIGURATION](docs/AWS_SDK_CONFIGURATION.md) for instructions 
on configuring the AWS SDK for server-side AWS connectivity.

## Requirements

Node >= 0.12

## Building and Running

The c3vis server is based on ExpressJS. The client predominantly uses D3.js, 
jQuery and Bootstrap.

Run the following to build and run the server ("package.json" contains instructions to pre-install required node modules):

```
npm start
```

Now browse to the app at `http://localhost:3000`.

## Testing

To run the server-side unit test suite with mocha and chai:
 
```
npm run test
```

## Usage

### Approach

When a client browser first connects to the c3vis server, the Cluster dropdown will be populated with ECS cluster names for the configured region.

Select from the dropdown to view the resources allocated to that cluster. If no cluster names appear in the dropdown, check the server logs and ensure the correct region is configured (see below).

The list of clusters and the user's current selection are stored in cookies. Use the ```[refresh list]``` dropdown entry to refresh the list of clusters.

The Y axis shows total memory or CPU available for the instances. Memory is the default resource type represented. Use the "resourceType" query parameter to toggle between "memory" and "cpu".  E.g. ```localhost:3000/?resourceType=cpu```

The X axis displays the Private IP Address for each EC2 instance. Right-clicking the IP address shows the context menu with links to browse the instance in the ECS and EC2 consoles.

### AWS API Call Throttling

In order to prevent AWS API Rate limiting issues for large clusters, the server:

* Introduces a delay between API calls (configurable via `aws.apiDelay` setting)
* Limits the number of items retrieved per page in `list` and `describe` API calls (configurable via `aws.*PageSize`)
* Limits the number of asynchronous API calls it makes at a time (configurable via `aws.maxSimultaneous*Calls`)

You can increase or decrease each of these settings to suit each environment c3vis is deployed to.

### Short Polling, Server-Side Caching and Fetch Status

For each cluster requested, the server caches cluster data in-memory while the client polls the server until the cache is populated.

For an explanation on how the client polls the server for cluster data and the applicable fetch statuses, see [SHORT_POLLING_FETCH_STATUS](docs/SHORT_POLLING_FETCH_STATUS.md).


## Debugging

### Sample Clusters for Testing

From the browser, use a ```"?static=true"``` query parameter to have the server return static test data. Useful for testing when server is unable to connect to AWS.

Browse to `http://localhost:3000/?static=true`.

### Server Debug Logging

To see all debug log entries:

```
DEBUG=* npm start
```

To see just API debug log entries:

```
DEBUG=api npm start
```

## Running with Docker

Build and tag the image:

```
docker build -t c3vis .
```

Run the container: (can remove ```AWS_ACCESS_KEY_ID``` and ```AWS_SECRET_ACCESS_KEY``` if deployed somewhere with appropriate IAM access)

```
docker run -e "AWS_REGION=<region>" -e "AWS_ACCESS_KEY_ID=<accesskey>" -e "AWS_SECRET_ACCESS_KEY=<secretkey>" -p 3000:3000 c3vis
```


Browse to `<docker localhost>:3000` (e.g. [http://192.168.99.100:3000](http://192.168.99.100:3000))


# Credits

Created by [Matt Callanan](https://github.com/mattcallanan) with contributions from [Mark Malone](https://github.com/malonem) and with thanks to internal Expedia reviewers for their suggestions and advice.


# Legal

This project is available under the [Apache 2.0 License](http://www.apache.org/licenses/LICENSE-2.0.html).

Copyright 2018 Expedia Inc.
