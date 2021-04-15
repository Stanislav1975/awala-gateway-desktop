import { ipcRenderer } from 'electron';
import React, { Component } from 'react';
import '../styles.css'
import Home from './home';
import Onboarding from './onboarding';
import Settings from './settings';
import Synchronize from './synchronize';

enum Status {
  HOME,
  ONBOARDING,
  SYNCHRONIZE,
  SETTINGS
}

interface Props {
}

interface State {
  readonly status: Status
  readonly token: string
}

class Index extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const onboarded = typeof localStorage.getItem('onboarded') === 'string';
    this.state = {
      status: !onboarded ? Status.ONBOARDING : Status.HOME,
      token: ''
    };
    ipcRenderer.on('show-public-gateway', this.showSettings.bind(this));
    ipcRenderer.on('token', this.setToken.bind(this));
  }
  public render() : JSX.Element {
    switch(this.state.status) {
      case Status.ONBOARDING:
        return <Onboarding onComplete={this.onOnboardingComplete.bind(this)} />;
      case Status.SYNCHRONIZE:
        return <Synchronize token={this.state.token} onComplete={this.returnToHome.bind(this)} />;
      case Status.SETTINGS:
        return <Settings token={this.state.token} onComplete={this.returnToHome.bind(this)} />;
      case Status.HOME:
      default:
        return <Home token={this.state.token} onSynchronize={this.onSynchronize.bind(this)}/>;
    }
  }
  private onOnboardingComplete() : void {
    localStorage.setItem('onboarded', 'onboarded');
    this.setState({'status': Status.HOME});
  }
  private onSynchronize() : void {
    this.setState({'status': Status.SYNCHRONIZE});
  }
  private returnToHome() : void {
    this.setState({'status': Status.HOME});
  }
  private showSettings() : void {
    this.setState({'status': Status.SETTINGS});
  }
  private setToken(_: Event, token: string) : void {
    this.setState({token});
  }
}

export default Index;
