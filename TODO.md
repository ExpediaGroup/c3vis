## UI
* Menubar with:
  * Selectable Region
  * Selectable AWS account – requires ability for mutliple config files server side
* Show clusters as tabbed view with one cluster per tab
* Add toggle button to switch between memory vs CPU resourceType
* Show an exploded view of task with more details when hovering over tasks:
  * Show containers within tasks
  * Show memory breakdown across containers
* Sliding timebar to see historical data for comparison (like google street view)
* Show container actual memory utilisation vs reserved memory utilisation
* Provide access to more troubleshooting information (such as docker logs, ECS logs)

## Server
* Write a plugin system that lets adopters plugin their own statistics from favourite monitoring tool
* Pluggable backend system that could support other public or private cloud providers
* Cache responses server-side to reduce AWS API calls
* Make the data transfer between client and server more efficient - Separate requests for task and instance data and populate graph asynchronously
* Arrow functions: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions

### Server Configuration
* Make logging levels configurable
* Make delay between AWS API calls configurable

## Testing
  * Capture ECS JSON responses for testing and replay with mock AWS ECS server
  * https://fbflex.wordpress.com/2013/11/18/mocking-out-amazon-aws-sdk-with-the-betamax-recording-proxy-for-testing/
