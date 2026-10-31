using CampusBalance.Core;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Foundation;
using Windows.UI;

namespace CampusBalance.App;

// 左侧余额列表：滑动圆角色块 + 数字排版，对应 dashboard.html 的 .side / .item / .pill。
public sealed partial class MainWindow
{
    private sealed class RailEntry
    {
        public required Button Host { get; init; }
        public required TextBlock Name { get; init; }
        public required TextBlock Value { get; init; }
        public required TextBlock Unit { get; init; }
        public required TextBlock Note { get; init; }
        public required SolidColorBrush NameBrush { get; init; }
        public required SolidColorBrush ValueBrush { get; init; }
        public required SolidColorBrush UnitBrush { get; init; }
        public required SolidColorBrush NoteBrush { get; init; }
    }

    private double pillX;
    private double pillY;
    private double thumbX;

    private TranslateTransform SelectionPillTransform => (TranslateTransform)SelectionPill.RenderTransform;
    private TranslateTransform ChartModeThumbTransform => (TranslateTransform)ChartModeThumb.RenderTransform;

    private void BuildRail()
    {
        var railStyle = (Style)Application.Current.Resources["RailButtonStyle"];
        var numericFont = (FontFamily)Application.Current.Resources["NumericFont"];
        var numericMediumFont = (FontFamily)Application.Current.Resources["NumericMediumFont"];
        var mutedColor = ((SolidColorBrush)MutedBrush).Color;
        var inkColor = InkColor;

        foreach (var metric in Enum.GetValues<Metric>())
        {
            var reading = readings[(int)metric];
            var nameBrush = new SolidColorBrush(mutedColor);
            var valueBrush = new SolidColorBrush(inkColor);
            var unitBrush = new SolidColorBrush(inkColor);
            var noteBrush = new SolidColorBrush(mutedColor);

            var name = new TextBlock
            {
                Text = reading.Name,
                FontSize = 13,
                TextWrapping = TextWrapping.Wrap,
                Foreground = nameBrush,
            };
            var value = new TextBlock
            {
                Text = "—",
                FontFamily = numericFont,
                FontWeight = FontWeights.Bold,
                FontSize = 34,
                LineHeight = 36,
                LineStackingStrategy = LineStackingStrategy.BlockLineHeight,
                Foreground = valueBrush,
            };
            var unit = new TextBlock
            {
                Text = reading.Unit,
                FontFamily = numericMediumFont,
                FontWeight = FontWeights.Medium,
                FontSize = 14,
                Opacity = 0.7,
                Margin = new Thickness(5, 0, 0, 2),
                VerticalAlignment = VerticalAlignment.Bottom,
                Foreground = unitBrush,
            };
            var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 0 };
            valueRow.Children.Add(value);
            valueRow.Children.Add(unit);
            var note = new TextBlock
            {
                Text = reading.Note,
                FontSize = 12,
                LineHeight = 17,
                TextWrapping = TextWrapping.Wrap,
                Foreground = noteBrush,
            };
            var content = new StackPanel { Spacing = 6, HorizontalAlignment = HorizontalAlignment.Stretch };
            content.Children.Add(name);
            content.Children.Add(valueRow);
            content.Children.Add(note);

            var index = (int)metric;
            var host = new Button
            {
                Style = railStyle,
                Content = content,
                Tag = metric,
                TabIndex = index,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
            };
            AutomationProperties.SetName(host, reading.Name);
            host.Click += (_, _) => SelectMetric(index, focus: false);
            host.PointerEntered += (_, _) =>
            {
                if (index != selectedMetric) host.Background = HoverBrush;
            };
            host.PointerExited += (_, _) =>
            {
                if (index != selectedMetric) host.Background = null;
            };

            railEntries.Add(new RailEntry
            {
                Host = host,
                Name = name,
                Value = value,
                Unit = unit,
                Note = note,
                NameBrush = nameBrush,
                ValueBrush = valueBrush,
                UnitBrush = unitBrush,
                NoteBrush = noteBrush,
            });
            RailItems.Children.Add(host);
        }
    }

    private void UpdateRailContent()
    {
        for (var i = 0; i < railEntries.Count && i < readings.Count; i++)
        {
            var entry = railEntries[i];
            var reading = readings[i];
            entry.Value.Text = reading.Status == ReadingStatus.Ok ? reading.DisplayValue : "—";
            entry.Unit.Text = reading.Unit;
            entry.Note.Text = reading.Note ?? "";
            AutomationProperties.SetName(entry.Host, reading.Name + "，" + entry.Value.Text + " " + reading.Unit + "，" + (reading.Note ?? ""));
        }
    }

    private void RenderRail()
    {
        UpdateRailColors(animate: false);
        RepositionPill(animate: false);
    }

    private void UpdateRailColors(bool animate)
    {
        var muted = ((SolidColorBrush)MutedBrush).Color;
        var ink = InkColor;
        var onAccent = ((SolidColorBrush)OnAccentBrush).Color;
        for (var i = 0; i < railEntries.Count; i++)
        {
            var entry = railEntries[i];
            var selected = i == selectedMetric;
            var valueColor = selected ? onAccent : ink;
            var labelColor = selected ? onAccent : muted;
            if (animate && !ReduceMotion)
            {
                AnimateColor(entry.ValueBrush, valueColor, TimeSpan.FromMilliseconds(300));
                AnimateColor(entry.UnitBrush, valueColor, TimeSpan.FromMilliseconds(300));
                AnimateColor(entry.NameBrush, labelColor, TimeSpan.FromMilliseconds(300));
                AnimateColor(entry.NoteBrush, labelColor, TimeSpan.FromMilliseconds(300));
            }
            else
            {
                entry.ValueBrush.Color = valueColor;
                entry.UnitBrush.Color = valueColor;
                entry.NameBrush.Color = labelColor;
                entry.NoteBrush.Color = labelColor;
            }
            entry.Name.Opacity = selected ? 0.85 : 1;
            entry.Note.Opacity = selected ? 0.85 : 1;
            if (!selected) entry.Host.Background = null;
        }
    }

    private void SelectMetric(int index, bool focus)
    {
        if (readings.Count == 0) return;
        selectedMetric = Math.Clamp(index, 0, readings.Count - 1);
        foreach (var entry in railEntries) entry.Host.Background = null;
        UpdateRailColors(animate: true);
        RepositionPill(animate: true);
        RenderPanel(animate: true);
        if (focus) railEntries[selectedMetric].Host.Focus(FocusState.Programmatic);
    }

    private void RepositionPill(bool animate)
    {
        if (selectedMetric >= railEntries.Count) return;
        var host = railEntries[selectedMetric].Host;
        if (host.ActualWidth <= 0 || host.ActualHeight <= 0) return;
        SelectionPill.Width = host.ActualWidth;
        SelectionPill.Height = host.ActualHeight;
        var point = host.TransformToVisual(RailHost).TransformPoint(new Point(0, 0));
        if (!animate || ReduceMotion)
        {
            SelectionPillTransform.X = point.X;
            SelectionPillTransform.Y = point.Y;
            pillX = point.X;
            pillY = point.Y;
            return;
        }
        AnimateTransform(SelectionPillTransform, "X", pillX, point.X, () => pillX = point.X);
        AnimateTransform(SelectionPillTransform, "Y", pillY, point.Y, () => pillY = point.Y);
    }

    // 圆角按钮的滑动色块：先动画，结束后写回基础值，避免动画持续持有旧值。
    private void AnimateTransform(TranslateTransform transform, string property, double from, double to, Action completed)
    {
        var animation = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation
        {
            From = from,
            To = to,
            Duration = new Duration(TimeSpan.FromMilliseconds(550)),
            EasingFunction = EaseOut,
            FillBehavior = Microsoft.UI.Xaml.Media.Animation.FillBehavior.Stop,
        };
        Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(animation, transform);
        Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(animation, property);
        var storyboard = new Microsoft.UI.Xaml.Media.Animation.Storyboard();
        storyboard.Children.Add(animation);
        storyboard.Completed += (_, _) => completed();
        storyboard.Begin();
    }

    // ===================== 柱状 / 折线切换（.seg） =====================

    private void BarMode_Click(object sender, RoutedEventArgs e)
    {
        if (!lineMode) return;
        lineMode = false;
        UpdateChartModeSwitch(animate: true);
        RenderChart(animate: true);
    }

    private void LineMode_Click(object sender, RoutedEventArgs e)
    {
        if (lineMode) return;
        lineMode = true;
        UpdateChartModeSwitch(animate: true);
        RenderChart(animate: true);
    }

    private void UpdateChartModeSwitch(bool animate)
    {
        var width = BarModeButton.ActualWidth > 0 ? BarModeButton.ActualWidth : 64;
        ChartModeThumb.Width = width;
        var target = lineMode ? width : 0;
        if (!animate || ReduceMotion)
        {
            ChartModeThumbTransform.X = target;
            thumbX = target;
        }
        else
        {
            AnimateTransform(ChartModeThumbTransform, "X", thumbX, target, () => thumbX = target);
        }
        BarModeButton.Foreground = lineMode ? MutedBrush : OnAccentBrush;
        LineModeButton.Foreground = lineMode ? OnAccentBrush : MutedBrush;
    }
}
