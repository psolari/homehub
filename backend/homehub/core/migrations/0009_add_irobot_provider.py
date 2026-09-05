from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0008_dashboard_grid_groups"),
    ]

    operations = [
        migrations.AlterField(
            model_name="integrationaccount",
            name="provider",
            field=models.CharField(
                choices=[
                    ("spotify", "Spotify"),
                    ("irobot", "iRobot"),
                    ("hive", "Hive"),
                    ("ring", "Ring"),
                    ("alexa", "Amazon Alexa"),
                    ("ring_alarm_mqtt", "Ring Alarm MQTT"),
                ],
                max_length=30,
            ),
        ),
    ]
